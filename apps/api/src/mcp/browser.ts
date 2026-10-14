import { Hono } from "hono"
import { z } from "zod"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { auth, mcpResource } from "../auth.js"
import { getOrCreateAppUser } from "../db/repositories.js"
import { withTenant } from "../db/tenant.js"
import { MCP_PERMISSIONS } from "./scopes.js"

export const mcpBrowserRoutes = new Hono()
mcpBrowserRoutes.get("/config", (c) => c.json({
  resource: mcpResource, ssoEnabled: Boolean(process.env.CLOUDFLARE_ACCESS_DISCOVERY_URL),
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
       v.revoked_at as "revokedAt" from "oauthConsent" g
     join "oauthClient" a on a."clientId" = g."clientId"
     left join mcp_grant_revocations v on v.client_id = g."clientId" and v.user_id = $2
     where g."userId" = $1 and g.resources @> $3::jsonb`,
    [user.session.user.id, user.appUserId, JSON.stringify([mcpResource])],
  )).rows)
  return c.json({ agents, resource: mcpResource })
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
  })
  return c.json({ revoked: true })
})
