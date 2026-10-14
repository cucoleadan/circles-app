import { serve } from "@hono/node-server"
import { installFetchTimeout } from "@workspace/core"
import { Hono } from "hono"
import { z } from "zod"

import { auth } from "./auth.js"
import { db } from "./db.js"
import {
  archivePerson,
  createPerson,
  getOrCreateAppUser,
  listPeople,
  updatePerson,
} from "./db/repositories.js"
import { withTenant } from "./db/tenant.js"
import { ext } from "./routes/ext.js"
import { v1 } from "./routes/v1.js"
import { mcpRoutes } from "./mcp/server.js"
import { mcpBrowserRoutes } from "./mcp/browser.js"

installFetchTimeout()

const app = new Hono()

const appUrl = process.env.APP_URL ?? "http://localhost:4321"
const allowedOrigins = new Set([
  appUrl,
  "http://localhost:4321",
  "http://127.0.0.1:4321",
  "https://circles.mhntwrkdan.dev",
])
const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])

app.use("*", async (c, next) => {
  if (
    writeMethods.has(c.req.method) &&
    !c.req.path.startsWith("/api/auth") && c.req.path !== "/api/mcp"
  ) {
    const origin = c.req.header("origin")
    const isExtension =
      c.req.header("x-circles-extension") === "v1" ||
      c.req.header("x-stackedhq-extension") === "v1"
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

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
app.on(["GET", "HEAD"], "/.well-known/*", async (c) => {
  c.header("Access-Control-Allow-Origin", "*")
  return auth.handler(c.req.raw)
})
app.route("/api/mcp", mcpRoutes)
app.route("/api/mcp", mcpBrowserRoutes)

app.route("/api/v1", v1)
app.route("/api/ext", ext)
app.route("/app", ext)

async function appUser(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  return getOrCreateAppUser(session.user.id)
}

// Legacy surface for the interim workspace island; the Phase 4 UI moves to
// /api/v1. Translates the old status vocabulary onto the consolidated one.
const legacyToStatus: Record<string, string> = {
  close: "active",
  dormant: "archived",
}
const statusToLegacy: Record<string, string> = {
  "reach-out": "close",
  contacted: "close",
  conversation: "close",
  archived: "dormant",
}

const legacyStatus = z.enum(["new", "active", "close", "dormant"])

const contactInput = z.object({
  name: z.string().trim().min(1).max(120),
  handle: z
    .string()
    .trim()
    .max(120)
    .transform((value) => value.replace(/^@/, ""))
    .optional()
    .default(""),
  notes: z.string().trim().max(5000).optional().default(""),
  relationshipStatus: legacyStatus.optional().default("new"),
})

app.get("/api/contacts", async (c) => {
  const userId = await appUser(c.req.raw.headers)
  if (!userId) return c.json({ error: "Unauthorized" }, 401)

  const people = await withTenant({ appUserId: userId }, (client) =>
    listPeople(client, {
      search: c.req.query("search")?.trim() || undefined,
      limit: Number(c.req.query("limit") ?? 1000),
    })
  )
  return c.json({
    contacts: people.map((person) => ({
      id: person.id,
      name: person.name,
      handle: person.handle,
      notes: person.notes,
      relationshipStatus:
        statusToLegacy[person.relationshipStatus ?? "new"] ??
        person.relationshipStatus ??
        "new",
      createdAt: person.createdAt,
    })),
  })
})

app.post("/api/contacts", async (c) => {
  const userId = await appUser(c.req.raw.headers)
  if (!userId) return c.json({ error: "Unauthorized" }, 401)

  const parsed = contactInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid contact" }, 400)

  const person = await withTenant({ appUserId: userId }, (client) =>
    createPerson(client, userId, {
      name: parsed.data.name,
      handle: parsed.data.handle || null,
      notes: parsed.data.notes || null,
      relationshipStatus:
        legacyToStatus[parsed.data.relationshipStatus] ??
        parsed.data.relationshipStatus,
    })
  )
  return c.json({ contact: person }, 201)
})

app.patch("/api/contacts/:contactId", async (c) => {
  const userId = await appUser(c.req.raw.headers)
  if (!userId) return c.json({ error: "Unauthorized" }, 401)

  const parsed = contactInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid contact" }, 400)

  const person = await withTenant({ appUserId: userId }, (client) =>
    updatePerson(client, c.req.param("contactId"), {
      name: parsed.data.name,
      handle: parsed.data.handle || null,
      notes: parsed.data.notes || null,
      relationshipStatus:
        legacyToStatus[parsed.data.relationshipStatus] ??
        parsed.data.relationshipStatus,
    })
  )
  if (!person) return c.json({ error: "Contact not found" }, 404)
  return c.json({ contact: person })
})

app.delete("/api/contacts/:contactId", async (c) => {
  const userId = await appUser(c.req.raw.headers)
  if (!userId) return c.json({ error: "Unauthorized" }, 401)

  const archived = await withTenant({ appUserId: userId }, (client) =>
    archivePerson(client, c.req.param("contactId"))
  )
  if (!archived) return c.json({ error: "Contact not found" }, 404)
  return c.body(null, 204)
})

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
