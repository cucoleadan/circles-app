import { randomUUID } from "node:crypto"
import { discoverSubstackTools } from "@workspace/core"
import { withTenant } from "../db/tenant.js"
import { currentConnection } from "../db/scheduled-notes.js"
import type { McpScope } from "./scopes.js"

export interface McpPrincipal {
  appUserId: string
  authUserId: string
  clientId: string
  issuedAt: number
  scopes: ReadonlySet<string>
}

// Circles already syncs these: circles_get_connection (profile), the 10-minute activity
// sync (list_people/list_comments/person timelines), circles_list_notes (own Notes),
// the daily following sweep (list_people view "following") and circles_get_note_engagement.
export const CIRCLES_COVERED_SDK_TOOLS = new Set([
  "get_authenticated_profile", "get_activity", "get_unread_activity", "get_notes", "get_following", "get_note_engagement",
])
const sdkTools = await discoverSubstackTools()
export const substackTools = sdkTools.filter((tool) => {
  const canonical = tool.name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  return !CIRCLES_COVERED_SDK_TOOLS.has(canonical) &&
    (tool.name === canonical || !sdkTools.some((other) => other.name === canonical))
})

export function sdkScopes(args: Record<string, unknown>): McpScope[] {
  const raw = ["include_records", "includeRecords", "include_rows", "includeRows", "include_raw", "includeRaw", "include_raw_pages", "includeRawPages"]
    .some((key) => args[key] === true)
  return raw ? ["substack:read", "substack:records"] : ["substack:read"]
}

// Agents read the server's copy; a live Substack read happens only on a cache miss or an explicit refresh.
export const SDK_CACHE_MS = 6 * 60 * 60 * 1000
export const SDK_REFRESH_MIN_MS = 10 * 60 * 1000

export async function enqueueSdkTool(principal: McpPrincipal, name: string, args: Record<string, unknown>, scopes: McpScope[], refresh = false) {
  return withTenant({ appUserId: principal.appUserId }, async (client) => {
    const conn = await currentConnection(client, principal.appUserId)
    if (!conn || conn.status !== "active") throw new Error("Connect an active Substack account first")
    // Shared across the tenant's clients; identical arguments imply identical required scopes.
    const cached = (await client.query(
      `select result, finished_at as "fetchedAt" from mcp_tool_runs
       where connection_id = $1 and tool_name = $2 and arguments = $3::jsonb and result is not null
         and coalesce(result->>'isError', 'false') <> 'true' and finished_at > now() - make_interval(secs => $4)
       order by finished_at desc limit 1`,
      [conn.id, name, JSON.stringify(args), (refresh ? SDK_REFRESH_MIN_MS : SDK_CACHE_MS) / 1000],
    )).rows[0]
    if (cached) return { cached: cached as { result: Record<string, unknown>; fetchedAt: Date } }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`mcp:${principal.appUserId}`])
    const recent = await client.query(
      `select r.id from mcp_tool_runs r join jobs j on j.id = r.job_id
       where r.client_id = $1 and r.connection_id = $2 and r.tool_name = $3 and r.arguments = $4::jsonb
         and r.token_issued_at = $5 and j.status in ('pending', 'running') order by r.created_at desc limit 1`,
      [principal.clientId, conn.id, name, JSON.stringify(args), principal.issuedAt],
    )
    if (recent.rows[0]) return { runId: recent.rows[0].id, status: "pending", pollTool: "circles_get_tool_run" }
    const active = await client.query(
      `select count(*)::int as total from mcp_tool_runs r join jobs j on j.id = r.job_id
       where j.status in ('pending', 'running')`,
    )
    if (active.rows[0].total >= 10) throw new Error("Ten SDK reads are already queued; wait for their results")
    const runId = randomUUID()
    await client.query(
      `insert into mcp_tool_runs(id, user_id, connection_id, auth_user_id, client_id, token_issued_at, tool_name, arguments, required_scopes)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
      [runId, principal.appUserId, conn.id, principal.authUserId, principal.clientId, principal.issuedAt, name, JSON.stringify(args), JSON.stringify(scopes)],
    )
    const job = await client.query(
      `insert into jobs(type, payload, status, max_attempts) values ('mcp:substack', $1::jsonb, 'pending', 1) returning id`,
      [JSON.stringify({ runId, userId: principal.appUserId, connectionId: conn.id })],
    )
    await client.query("update mcp_tool_runs set job_id = $2 where id = $1", [runId, job.rows[0].id])
    return { runId, status: "pending", pollTool: "circles_get_tool_run" }
  })
}

export async function getSdkRun(principal: McpPrincipal, runId: string) {
  return withTenant({ appUserId: principal.appUserId }, async (client) => {
    const row = (await client.query(
      `select r.id, r.required_scopes as scopes, r.result, r.created_at as "createdAt", r.finished_at as "finishedAt",
         j.status from mcp_tool_runs r left join jobs j on j.id = r.job_id
       where r.id = $1 and r.client_id = $2`, [runId, principal.clientId],
    )).rows[0]
    if (!row) throw new Error("Tool run not found")
    if (!row.scopes.every((scope: string) => principal.scopes.has(scope)))
      throw new Error("Additional permission required to read this result")
    const { scopes: _, ...safe } = row
    return safe
  })
}
