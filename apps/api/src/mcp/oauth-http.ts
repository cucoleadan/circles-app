import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "../auth.js"

export const oauthProtocolRoutes = new Hono()
const oauthErrors = new Set(["invalid_request", "invalid_client", "invalid_grant", "invalid_scope",
  "invalid_target", "unauthorized_client", "unsupported_grant_type", "access_denied", "server_error"])
for (const endpoint of ["authorize", "consent", "continue", "token"]) {
  oauthProtocolRoutes.use(`/api/auth/oauth2/${endpoint}`, async (c, next) => {
    if (c.req.method === "OPTIONS") return next()
    await next()
    const data = await c.res.clone().json().catch(() => null) as Record<string, unknown> | null
    const target = c.res.headers.get("location") ?? (typeof data?.url === "string" ? data.url : null)
    let callback: URL | undefined
    try { if (target) callback = new URL(target) } catch { /* Internal login/consent redirects are relative. */ }
    // Log structure only: callback URLs, codes, state and token values are credentials.
    console.info("[MCP OAuth]", JSON.stringify({
      endpoint, status: c.res.status,
      error: typeof data?.error === "string" && oauthErrors.has(data.error) ? data.error : undefined,
      callback: callback ? {
        codePresent: !!callback.searchParams.get("code"), statePresent: !!callback.searchParams.get("state"),
        errorPresent: callback.searchParams.has("error"),
      } : undefined,
      ...(endpoint === "token" && { accessTokenPresent: typeof data?.access_token === "string" }),
    }))
  })
}
// OAuth clients use codes/client credentials here; cookie login/consent stays same-origin.
const protocolCors = cors({
  origin: "*", allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "DPoP"],
  exposeHeaders: ["WWW-Authenticate"],
})
for (const endpoint of ["oauth2/token", "oauth2/register", "oauth2/revoke", "oauth2/introspect", "jwks"]) {
  const path = `/api/auth/${endpoint}`
  oauthProtocolRoutes.use(path, protocolCors)
  oauthProtocolRoutes.on(["GET", "POST"], path, (c) => auth.handler(c.req.raw))
}
oauthProtocolRoutes.use("/.well-known/*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] }))
oauthProtocolRoutes.on(["GET", "HEAD"], "/.well-known/*", (c) => auth.handler(c.req.raw))
