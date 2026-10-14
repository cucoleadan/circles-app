import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "../auth.js"

export const oauthProtocolRoutes = new Hono()
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
