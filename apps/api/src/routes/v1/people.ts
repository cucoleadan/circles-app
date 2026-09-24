import { Hono } from "hono"
import { z } from "zod"

import {
  archivePerson,
  createPerson,
  getPerson,
  listPeople,
  personInteractions,
  updatePerson,
} from "../../db/repositories.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const peopleRoutes = new Hono<V1Env>()

const relationshipStatus = z.enum([
  "new",
  "reach-out",
  "contacted",
  "conversation",
  "active",
  "archived",
])

const optionalText = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .nullable()
  .transform((val) => (val && val.length > 0 ? val : null))

const personInput = z.object({
  name: z.string().trim().min(1).max(120),
  handle: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((val) => {
      if (!val) return null
      const cleaned = val.replace(/^@/, "").trim()
      return cleaned.length > 0 ? cleaned : null
    }),
  notes: z.string().max(10000).optional().nullable(),
  relationshipStatus: relationshipStatus.optional().nullable(),
  substackProfileId: optionalText,
  profileUrl: optionalText,
  publicationUrl: optionalText,
  avatarUrl: optionalText,
  isFollower: z.boolean().optional(),
  isFollowing: z.boolean().optional(),
  isSubscriber: z.boolean().optional(),
  isSubscribedTo: z.boolean().optional(),
})

peopleRoutes.get("/people", async (c) => {
  const people = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    listPeople(client, {
      search: c.req.query("search")?.trim() || undefined,
      status: c.req.query("status") || undefined,
      tagId: c.req.query("tagId") || undefined,
      listId: c.req.query("listId") || undefined,
      view: c.req.query("view") || undefined,
      sort: c.req.query("sort") || undefined,
      since: c.req.query("since") || undefined,
      until: c.req.query("until") || undefined,
      hasRestack: c.req.query("hasRestack") === "true",
      hasComment: c.req.query("hasComment") === "true",
      hasLike: c.req.query("hasLike") === "true",
      actionType: c.req.query("actionType") || undefined,
      limit: Number(c.req.query("limit") ?? 1000),
      offset: c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
    })
  )
  return c.json({ people })
})

peopleRoutes.post("/people", async (c) => {
  const parsed = personInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid person" }, 400)
  const person = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    createPerson(client, c.get("appUser"), parsed.data)
  )
  return c.json({ person }, 201)
})

peopleRoutes.get("/people/:personId", async (c) => {
  const found = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    getPerson(client, c.req.param("personId"))
  )
  if (!found) return c.json({ error: "Person not found" }, 404)
  return c.json(found)
})

peopleRoutes.post("/people/:personId/refetch", async (c) => {
  const userId = c.get("appUser")
  const personId = c.req.param("personId")
  const result = await withTenant({ appUserId: userId }, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [userId, personId])
    const person = (await client.query(
      `select id, handle, substack_profile_id from people
       where id = $1 and user_id = $2 and archived_at is null`,
      [personId, userId],
    )).rows[0]
    if (!person) return { status: 404 as const, error: "Contact not found" }
    if (!person.handle && !person.substack_profile_id)
      return { status: 400 as const, error: "Contact has no Substack identity" }
    const connection = (await client.query(
      `select id from substack_connections where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId],
    )).rows[0]
    if (!connection) return { status: 409 as const, error: "No active Substack connection" }
    const recent = (await client.query(
      `select id, status from jobs where type = 'refetch:contact'
       and payload->>'userId' = $1 and payload->>'personId' = $2
       and (status in ('pending', 'running')
         or (status in ('done', 'dead', 'failed') and created_at > now() - interval '10 minutes'))
       order by id desc limit 1`,
      [userId, personId],
    )).rows[0]
    if (recent && !["pending", "running"].includes(recent.status))
      return { status: 429 as const, error: "This contact was refetched recently. Try again in 10 minutes." }
    if (recent) return { status: 202 as const, jobId: String(recent.id) }
    const inserted = await client.query(
      `insert into jobs (type, payload, status, max_attempts)
       values ('refetch:contact', $1, 'pending', 1) returning id`,
      [JSON.stringify({ userId, personId, connectionId: connection.id })],
    )
    return { status: 202 as const, jobId: String(inserted.rows[0].id) }
  })
  if ("error" in result) return c.json({ error: result.error }, result.status)
  return c.json({ jobId: result.jobId, status: "pending" }, 202)
})

peopleRoutes.get("/people/:personId/refetch/:jobId", async (c) => {
  const userId = c.get("appUser")
  const personId = c.req.param("personId")
  const jobId = c.req.param("jobId")
  if (!/^\d+$/.test(jobId)) return c.json({ error: "Job not found" }, 404)
  const job = await withTenant({ appUserId: userId }, async (client) => {
    const result = await client.query(
      `select status from jobs where id = $1 and type = 'refetch:contact'
       and payload->>'userId' = $2 and payload->>'personId' = $3`,
      [jobId, userId, personId],
    )
    return result.rows[0]
  })
  if (!job) return c.json({ error: "Job not found" }, 404)
  return c.json({ status: job.status })
})

peopleRoutes.patch("/people/:personId", async (c) => {
  const parsed = personInput.partial().safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid person" }, 400)
  try {
    const person = await withTenant({ appUserId: c.get("appUser") }, (client) =>
      updatePerson(client, c.req.param("personId"), parsed.data)
    )
    if (!person) return c.json({ error: "Person not found" }, 404)
    return c.json({ person })
  } catch (err: any) {
    if (err?.code === "23505") {
      return c.json({ error: "A contact with this handle already exists." }, 409)
    }
    throw err
  }
})

peopleRoutes.delete("/people/:personId", async (c) => {
  const appUser = c.get("appUser")
  const archived = await withTenant({ appUserId: appUser }, (client) =>
    archivePerson(client, c.req.param("personId"))
  )
  if (!archived) return c.json({ error: "Person not found" }, 404)
  return c.body(null, 204)
})

peopleRoutes.get("/people/:personId/interactions", async (c) => {
  try {
    const page = await withTenant({ appUserId: c.get("appUser") }, (client) =>
      personInteractions(client, c.req.param("personId"), {
        cursor: c.req.query("cursor") || undefined,
        limit: Number(c.req.query("limit") ?? 50),
      })
    )
    return c.json(page)
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid cursor")
      return c.json({ error: "Invalid cursor" }, 400)
    throw error
  }
})
