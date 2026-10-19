import { serve } from "@hono/node-server"
import { installFetchTimeout } from "@workspace/core"
import { Hono } from "hono"

import { appOrigins, auth } from "./auth.js"
import { db } from "./db.js"
import { ext } from "./routes/ext.js"
import { v1 } from "./routes/v1.js"
import { mcpRoutes } from "./mcp/server.js"
import { mcpBrowserRoutes } from "./mcp/browser.js"
import { oauthProtocolRoutes } from "./mcp/oauth-http.js"

installFetchTimeout()

const app = new Hono()

const allowedOrigins = new Set(appOrigins)
const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])

app.use("*", async (c, next) => {
  if (
    writeMethods.has(c.req.method) &&
    !c.req.path.startsWith("/api/auth") && c.req.path !== "/api/mcp"
  ) {
    const origin = c.req.header("origin")
    const isExtension = c.req.header("x-circles-extension") === "v1"
    if (origin && !allowedOrigins.has(origin) && !isExtension)
      return c.json({ error: "Forbidden origin" }, 403)
  }
  await next()
  c.res.headers.set("Cache-Control", "no-store")
})

app.get("/api/health", (c) => c.json({ status: "ok" }))
app.get("/api/ready", async (c) => {
  await db.query("select 1")
  return c.json({ status: "ready" })
})

app.route("/", oauthProtocolRoutes)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
app.route("/api/mcp", mcpRoutes)
app.route("/api/mcp", mcpBrowserRoutes)

app.route("/api/v1", v1)
app.route("/api/ext", ext)

app.onError((error, c) => {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : ""
  if (code === "23505")
    return c.json({ error: "A contact with that handle already exists." }, 409)
  console.error(error)
  return c.json({ error: "Something went wrong." }, 500)
})

const port = Number(process.env.PORT ?? 3000)
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Circles API listening on port ${port}`)
})

async function shutdown() {
  server.close()
  await db.end()
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
