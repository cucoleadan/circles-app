import { Hono } from "hono"
import { z } from "zod"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { auth, mcpResource } from "../auth.js"
import { getOrCreateAppUser } from "../db/repositories.js"
import { withTenant } from "../db/tenant.js"
import { MCP_PERMISSIONS, MCP_SCOPES, type McpScope } from "./scopes.js"
import { API_KEY_CLIENT_PREFIX, API_KEY_PREFIX, hashApiKey } from "./auth.js"
import { randomBytes, randomUUID } from "node:crypto"

export const mcpBrowserRoutes = new Hono()
mcpBrowserRoutes.get("/config", (c) => c.json({
  resource: mcpResource, ssoEnabled: Boolean(process.env.CLOUDFLARE_ACCESS_DISCOVERY_URL), permissions: MCP_PERMISSIONS,
}))
mcpBrowserRoutes.get("/consent", async (c) => {
  const query = c.req.query("oauth_query") ?? ""
  if (query.length > 16384 || !await verifyOAuthQueryParams(query, (await auth.$context).secret))
    return c.json({ error: "Authorization request is invalid or expired" }, 400)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Sign in to Circles first" }, 401)
  const params = new URLSearchParams(query)
  const client = await auth.api.getOAuthClientPublic({ headers: c.req.raw.headers, query: { client_id: params.get("client_id") ?? "" } })
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean)
  return c.json({ clientId: params.get("client_id"), name: client.client_name ?? "MCP client", email: session.user.email,
    permissions: scopes.map((scope) => ({ scope, description: scope === "offline_access" ? "Stay connected using a renewable grant" : MCP_PERMISSIONS[scope as keyof typeof MCP_PERMISSIONS] ?? scope })),
  })
})
// Keep browser grant management separate from agent tools and bearer authorization.
async function browserUser(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  return session ? { session, appUserId: await getOrCreateAppUser(session.user.id) } : null
}
mcpBrowserRoutes.get("/agents", async (c) => {
  const user = await browserUser(c.req.raw.headers)
  if (!user) return c.json({ error: "Unauthorized" }, 401)
  const agents = await withTenant({ appUserId: user.appUserId }, async (client) => (await client.query(
    `select g."clientId" as "clientId", a.name, g.scopes, g."updatedAt" as "updatedAt",
       v.revoked_at as "revokedAt", k.client_id is not null as "isKey", k.last_used_at as "lastUsedAt" from "oauthConsent" g
     join "oauthClient" a on a."clientId" = g."clientId"
     left join api_keys k on k.client_id = g."clientId"
     left join mcp_grant_revocations v on v.client_id = g."clientId" and v.user_id = $2
     where g."userId" = $1 and g.resources @> $3::jsonb`,
    [user.session.user.id, user.appUserId, JSON.stringify([mcpResource])],
  )).rows)
  return c.json({ agents, resource: mcpResource })
})
const MAX_API_KEYS = 20
const FRESH_SESSION_MS = 24 * 60 * 60 * 1000
// An API key is a first-party agent: its own client and consent, so revoking it is the agent revoke below.
mcpBrowserRoutes.post("/keys", async (c) => {
  const user = await browserUser(c.req.raw.headers)
  if (!user) return c.json({ error: "Unauthorized" }, 401)
  // A JSON content type forces a CORS preflight, so no other site can submit this form-style.
  if (!c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: "Send JSON" }, 415)
  // A key outlives the session, so a stolen old cookie must not be able to mint one.
  if (Date.now() - new Date(user.session.session.createdAt).getTime() > FRESH_SESSION_MS)
    return c.json({ error: "Sign in again to create an API key", reauthenticate: true }, 403)
  const parsed = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(MCP_SCOPES as [McpScope, ...McpScope[]])).min(1).max(MCP_SCOPES.length) })
    .safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Give the key a name and at least one permission" }, 400)
  const clientId = `${API_KEY_CLIENT_PREFIX}${randomUUID()}`
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`
  const scopes = JSON.stringify([...new Set(parsed.data.scopes)])
  const created = await withTenant({ appUserId: user.appUserId }, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`api-keys:${user.session.user.id}`])
    const active = (await client.query(
      `select count(*)::int as total from api_keys k join "oauthConsent" g on g."clientId" = k.client_id where g."userId" = $1`,
      [user.session.user.id])).rows[0].total as number
    if (active >= MAX_API_KEYS) return false
    await client.query(
      `insert into "oauthClient"(id, "clientId", name, "userId", scopes, "redirectUris", "grantTypes", "responseTypes",
         "tokenEndpointAuthMethod", disabled, "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5::jsonb, '[]', '[]', '[]', 'none', false, now(), now())`,
      [randomUUID(), clientId, parsed.data.name, user.session.user.id, scopes])
    await client.query(
      `insert into "oauthConsent"(id, "clientId", "userId", resources, scopes, "createdAt", "updatedAt")
       values ($1, $2, $3, $4::jsonb, $5::jsonb, now(), now())`,
      [randomUUID(), clientId, user.session.user.id, JSON.stringify([mcpResource]), scopes])
    await client.query("insert into api_keys(client_id, key_hash) values ($1, $2)", [clientId, hashApiKey(key)])
    return true
  })
  if (!created) return c.json({ error: `You already have ${MAX_API_KEYS} API keys; revoke one first` }, 409)
  return c.json({ key, clientId }, 201)
})
mcpBrowserRoutes.post("/agents/revoke", async (c) => {
  const user = await browserUser(c.req.raw.headers)
  if (!user) return c.json({ error: "Unauthorized" }, 401)
  const parsed = z.object({ clientId: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid client" }, 400)
  const clientId = parsed.data.clientId
  await withTenant({ appUserId: user.appUserId }, async (client) => {
    const owned = await client.query(`select 1 from "oauthConsent" where "clientId" = $1 and "userId" = $2 and resources @> $3::jsonb`,
      [clientId, user.session.user.id, JSON.stringify([mcpResource])])
    if (!owned.rowCount) return
    await client.query(`insert into mcp_grant_revocations(user_id, client_id) values ($1,$2)
      on conflict(user_id, client_id) do update set revoked_at = now()`, [user.appUserId, clientId])
    await client.query(`update "oauthRefreshToken" set revoked = now() where "clientId" = $1 and "userId" = $2`, [clientId, user.session.user.id])
    await client.query(`update "oauthAccessToken" set revoked = now() where "clientId" = $1 and "userId" = $2`, [clientId, user.session.user.id])
    await client.query(`delete from "oauthConsent" where "clientId" = $1 and "userId" = $2 and resources @> $3::jsonb`,
      [clientId, user.session.user.id, JSON.stringify([mcpResource])])
    // A revoked API key is gone for good: drop its hash and disable its client.
    if ((await client.query("delete from api_keys where client_id = $1", [clientId])).rowCount)
      await client.query(`update "oauthClient" set disabled = true, "updatedAt" = now() where "clientId" = $1 and "userId" = $2`,
        [clientId, user.session.user.id])
  })
  return c.json({ revoked: true })
})
