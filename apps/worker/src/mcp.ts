import { setTimeout as sleep } from "node:timers/promises"
import type { PoolClient } from "pg"
import { callSubstackTool, discoverSubstackTools, openSessionToken, redactMcpResult, SubstackClient } from "@workspace/core"
import { withTenant } from "./tenant.js"

export function serializeFetch(fetcher: typeof fetch) {
  let previous = Promise.resolve()
  const queued: typeof fetch = (input, init) => {
    const request = previous.then(() => fetcher(input, init))
    previous = request.then(() => {}, () => {})
    return request
  }
  return Object.assign(queued, { drain: () => previous })
}

export async function processMcpTool(client: PoolClient, userId: string, runId: string): Promise<Record<string, boolean>> {
  const row = await withTenant(client, userId, async () => (await client.query(
    `select r.*, c.publication_url, c.key_id, c.iv, c.ciphertext, c.status as connection_status,
       a.disabled as client_disabled,
       (select extract(epoch from revoked_at) from mcp_grant_revocations v
         where v.user_id = r.user_id and v.client_id = r.client_id) as revoked_at,
       (select scopes from "oauthConsent" g where g."userId" = r.auth_user_id
         and g."clientId" = r.client_id and g.resources @> $2::jsonb limit 1) as granted_scopes
     from mcp_tool_runs r
     join substack_connections c on c.id = r.connection_id and c.user_id = r.user_id
     join "oauthClient" a on a."clientId" = r.client_id
     where r.id = $1`,
    [runId, JSON.stringify([`${(process.env.APP_URL ?? "http://localhost:4321").replace(/\/$/, "")}/api/mcp`])],
  )).rows[0])
  if (!row || row.finished_at) return { skipped: true }
  const allowed = row.connection_status === "active" && !row.client_disabled &&
    (!row.revoked_at || Number(row.token_issued_at) > Number(row.revoked_at)) &&
    Array.isArray(row.granted_scopes) && row.required_scopes.every((scope: string) => row.granted_scopes.includes(scope))
  let result: unknown
  if (!allowed) {
    result = { isError: true, content: [{ type: "text", text: "The agent grant or Substack connection is no longer active" }] }
  } else {
    const tools = await discoverSubstackTools()
    if (!tools.some((tool) => tool.name === row.tool_name)) throw new Error("Unknown SDK MCP tool")
    const sessionToken = openSessionToken(row)
    const deadline = Date.now() + 4 * 60 * 1000
    let lastRequestAt = 0
    let expired = false
    let stopped = false
    const queuedFetch = serializeFetch(async (input, init) => {
      // shortcut: four-minute SDK run budget; add resumable analytics for larger archives.
      if (stopped || Date.now() >= deadline) throw new Error("SDK read exceeded the worker run budget; narrow the requested range")
      await sleep(Math.max(0, 1000 - (Date.now() - lastRequestAt)))
      if (stopped || Date.now() >= deadline) throw new Error("SDK read exceeded the worker run budget; narrow the requested range")
      const active = await withTenant(client, userId, async () => (await client.query(
        `select 1 from substack_connections c where c.id = $1 and c.status = 'active'
         and exists (select 1 from "oauthClient" a where a."clientId" = $2 and not coalesce(a.disabled, false))
         and exists (select 1 from "oauthConsent" g where g."clientId" = $2
           and g."userId" = $5 and g.scopes @> $6::jsonb)
         and not exists (select 1 from mcp_grant_revocations v where v.client_id = $2
           and v.user_id = $3 and extract(epoch from v.revoked_at) >= $4)`,
        [row.connection_id, row.client_id, userId, row.token_issued_at, row.auth_user_id, JSON.stringify(row.required_scopes)],
      )).rowCount)
      if (!active) throw new Error("The agent grant or Substack connection was revoked")
      lastRequestAt = Date.now()
      const response = await fetch(input, {
        ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))),
      })
      if (response.status === 401) expired = true
      return response
    })
    const sdk = new SubstackClient({
      sessionToken, publicationUrl: row.publication_url ?? undefined, fetch: queuedFetch,
    })
    try {
      result = redactMcpResult(await callSubstackTool(sdk, row.tool_name, row.arguments), sessionToken)
    } catch {
      result = { isError: true, content: [{ type: "text", text: "The SDK read failed; check the Substack connection and try again" }] }
    } finally {
      // Promise.all can fail while another SDK request still owns the database client.
      stopped = true
      await queuedFetch.drain()
    }
    if (expired) await withTenant(client, userId, () => client.query(
      "update substack_connections set status = 'expired', updated_at = now() where id = $1 and status = 'active'", [row.connection_id],
    ))
  }
  const encoded = JSON.stringify(result)
  if (Buffer.byteLength(encoded) > 2 * 1024 * 1024)
    result = { isError: true, content: [{ type: "text", text: "Result exceeds 2 MB; narrow the query or disable raw records" }] }
  await withTenant(client, userId, () => client.query(
    "update mcp_tool_runs set result = $2::jsonb, finished_at = now() where id = $1 and finished_at is null",
    [runId, JSON.stringify(result)],
  ))
  return { completed: true }
}
