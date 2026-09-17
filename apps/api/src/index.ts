import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { z } from "zod"

import { auth } from "./auth.js"
import { db } from "./db.js"

const app = new Hono()

app.get("/api/health", (c) => c.json({ status: "ok" }))
app.get("/api/ready", async (c) => {
  await db.query("select 1")
  return c.json({ status: "ready" })
})

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

async function userId(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  return session?.user.id
}

app.get("/api/contacts", async (c) => {
  const id = await userId(c.req.raw.headers)
  if (!id) return c.json({ error: "Unauthorized" }, 401)

  const result = await db.query(
    `select id, name, handle, notes, relationship_status as "relationshipStatus", created_at as "createdAt"
       from contacts
      where user_id = $1 and archived_at is null
      order by lower(name), id
      limit 100`,
    [id]
  )
  return c.json({ contacts: result.rows })
})

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
  relationshipStatus: z
    .enum(["new", "active", "close", "dormant"])
    .optional()
    .default("new"),
})

app.post("/api/contacts", async (c) => {
  const id = await userId(c.req.raw.headers)
  if (!id) return c.json({ error: "Unauthorized" }, 401)

  const parsed = contactInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid contact" }, 400)

  const result = await db.query(
    `insert into contacts (id, user_id, name, handle, notes, relationship_status)
     values ($1, $2, $3, nullif($4, ''), nullif($5, ''), $6)
     returning id, name, handle, notes, relationship_status as "relationshipStatus", created_at as "createdAt"`,
    [
      crypto.randomUUID(),
      id,
      parsed.data.name,
      parsed.data.handle,
      parsed.data.notes,
      parsed.data.relationshipStatus,
    ]
  )
  return c.json({ contact: result.rows[0] }, 201)
})

app.patch("/api/contacts/:contactId", async (c) => {
  const id = await userId(c.req.raw.headers)
  if (!id) return c.json({ error: "Unauthorized" }, 401)

  const parsed = contactInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid contact" }, 400)

  const result = await db.query(
    `update contacts
        set name = $3,
            handle = nullif($4, ''),
            notes = nullif($5, ''),
            relationship_status = $6,
            updated_at = now()
      where id = $1 and user_id = $2 and archived_at is null
      returning id, name, handle, notes, relationship_status as "relationshipStatus", created_at as "createdAt"`,
    [
      c.req.param("contactId"),
      id,
      parsed.data.name,
      parsed.data.handle,
      parsed.data.notes,
      parsed.data.relationshipStatus,
    ]
  )
  if (!result.rows[0]) return c.json({ error: "Contact not found" }, 404)
  return c.json({ contact: result.rows[0] })
})

app.delete("/api/contacts/:contactId", async (c) => {
  const id = await userId(c.req.raw.headers)
  if (!id) return c.json({ error: "Unauthorized" }, 401)

  const result = await db.query(
    `update contacts set archived_at = now(), updated_at = now()
      where id = $1 and user_id = $2 and archived_at is null
      returning id`,
    [c.req.param("contactId"), id]
  )
  if (!result.rows[0]) return c.json({ error: "Contact not found" }, 404)
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
