import { Hono } from "hono"
import { z } from "zod"

import { auth } from "../auth.js"
import {
  addListMember,
  archivePerson,
  attachTag,
  audit,
  circlesOverview,
  createList,
  createPerson,
  createTag,
  deleteList,
  deleteTag,
  detachTag,
  getOrCreateAppUser,
  getPerson,
  listLists,
  listPeople,
  listTags,
  personInteractions,
  removeListMember,
  updateList,
  updatePerson,
  updateTag,
} from "../db/repositories.js"
import { withTenant } from "../db/tenant.js"

export const v1 = new Hono<{ Variables: { appUser: string } }>()

v1.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("appUser", await getOrCreateAppUser(session.user.id))
  await next()
})

const relationshipStatus = z.enum([
  "new",
  "reach-out",
  "contacted",
  "conversation",
  "active",
  "archived",
])

const personInput = z.object({
  name: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(120).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  relationshipStatus: relationshipStatus.optional().nullable(),
  substackProfileId: z.string().max(200).optional().nullable(),
  profileUrl: z.string().url().max(500).optional().nullable(),
})

v1.get("/me", (c) => c.json({ appUser: c.get("appUser") }))

v1.get("/people", async (c) => {
  const people = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    listPeople(client, {
      search: c.req.query("search")?.trim() || undefined,
      status: c.req.query("status") || undefined,
      tagId: c.req.query("tagId") || undefined,
      listId: c.req.query("listId") || undefined,
      limit: Number(c.req.query("limit") ?? 100),
    })
  )
  return c.json({ people })
})

v1.post("/people", async (c) => {
  const parsed = personInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid person" }, 400)
  const person = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    createPerson(client, c.get("appUser"), parsed.data)
  )
  return c.json({ person }, 201)
})

v1.get("/people/:personId", async (c) => {
  const found = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    getPerson(client, c.req.param("personId"))
  )
  if (!found) return c.json({ error: "Person not found" }, 404)
  return c.json(found)
})

v1.patch("/people/:personId", async (c) => {
  const parsed = personInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid person" }, 400)
  const person = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    updatePerson(client, c.req.param("personId"), parsed.data)
  )
  if (!person) return c.json({ error: "Person not found" }, 404)
  return c.json({ person })
})

v1.delete("/people/:personId", async (c) => {
  const appUser = c.get("appUser")
  const archived = await withTenant({ appUserId: appUser }, (client) =>
    archivePerson(client, c.req.param("personId"))
  )
  if (!archived) return c.json({ error: "Person not found" }, 404)
  return c.body(null, 204)
})

v1.get("/people/:personId/interactions", async (c) => {
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

const namedInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
})

v1.get("/lists", async (c) => {
  const lists = await withTenant({ appUserId: c.get("appUser") }, listLists)
  return c.json({ lists })
})

v1.post("/lists", async (c) => {
  const parsed = namedInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid list" }, 400)
  const list = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    createList(client, c.get("appUser"), parsed.data.name, parsed.data.description)
  )
  return c.json({ list }, 201)
})

v1.patch("/lists/:listId", async (c) => {
  const parsed = namedInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid list" }, 400)
  const list = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    updateList(client, c.req.param("listId"), parsed.data.name, parsed.data.description)
  )
  if (!list) return c.json({ error: "List not found" }, 404)
  return c.json({ list })
})

v1.delete("/lists/:listId", async (c) => {
  const appUser = c.get("appUser")
  const deleted = await withTenant({ appUserId: appUser }, (client) =>
    deleteList(client, c.req.param("listId"))
  )
  if (!deleted) return c.json({ error: "List not found" }, 404)
  return c.body(null, 204)
})

v1.post("/lists/:listId/members", async (c) => {
  const parsed = z.object({ personId: z.string().min(1) }).safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "personId is required" }, 400)
  const appUser = c.get("appUser")
  const listId = c.req.param("listId")
  await withTenant({ appUserId: appUser }, async (client) => {
    await addListMember(client, appUser, listId, parsed.data.personId)
    await audit(client, appUser, "list.member.add", "list", listId)
  })
  return c.body(null, 204)
})

v1.delete("/lists/:listId/members/:personId", async (c) => {
  await withTenant({ appUserId: c.get("appUser") }, (client) =>
    removeListMember(client, c.req.param("listId"), c.req.param("personId"))
  )
  return c.body(null, 204)
})

const tagInput = z.object({
  name: z.string().trim().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
})

v1.get("/tags", async (c) => {
  const tags = await withTenant({ appUserId: c.get("appUser") }, listTags)
  return c.json({ tags })
})

v1.post("/tags", async (c) => {
  const parsed = tagInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid tag" }, 400)
  const tag = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    createTag(client, c.get("appUser"), parsed.data.name, parsed.data.color)
  )
  return c.json({ tag }, 201)
})

v1.patch("/tags/:tagId", async (c) => {
  const parsed = tagInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid tag" }, 400)
  const tag = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    updateTag(client, c.req.param("tagId"), parsed.data.name, parsed.data.color)
  )
  if (!tag) return c.json({ error: "Tag not found" }, 404)
  return c.json({ tag })
})

v1.delete("/tags/:tagId", async (c) => {
  const appUser = c.get("appUser")
  const deleted = await withTenant({ appUserId: appUser }, (client) =>
    deleteTag(client, c.req.param("tagId"))
  )
  if (!deleted) return c.json({ error: "Tag not found" }, 404)
  return c.body(null, 204)
})

v1.post("/tags/:tagId/people", async (c) => {
  const parsed = z.object({ personId: z.string().min(1) }).safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "personId is required" }, 400)
  const appUser = c.get("appUser")
  const tagId = c.req.param("tagId")
  await withTenant({ appUserId: appUser }, async (client) => {
    await attachTag(client, appUser, tagId, parsed.data.personId)
    await audit(client, appUser, "tag.attach", "tag", tagId)
  })
  return c.body(null, 204)
})

v1.delete("/tags/:tagId/people/:personId", async (c) => {
  await withTenant({ appUserId: c.get("appUser") }, (client) =>
    detachTag(client, c.req.param("tagId"), c.req.param("personId"))
  )
  return c.body(null, 204)
})

v1.get("/circles", async (c) => {
  const overview = await withTenant({ appUserId: c.get("appUser") }, circlesOverview)
  return c.json(overview)
})

v1.get("/connection", async (c) => {
  const appUser = c.get("appUser")
  const conn = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select id, publication_url as "publicationUrl",
              profile_id as "profileId", profile_name as "profileName",
              profile_handle as "profileHandle",
              status, last_verified_at as "lastVerifiedAt",
              created_at as "createdAt"
       from substack_connections
       where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [appUser]
    )
    return res.rows[0] ?? null
  })
  return c.json({ connection: conn })
})

v1.post("/connection", async (c) => {
  const appUser = c.get("appUser")
  const input = z
    .object({
      sessionToken: z.string().trim().min(1),
      publicationUrl: z.string().trim().url().optional().nullable(),
    })
    .safeParse(await c.req.json())
  if (!input.success) return c.json({ error: "Invalid connection payload" }, 400)

  const { sessionToken, publicationUrl } = input.data

  let profileName: string | null = null
  let profileHandle: string | null = null
  let profileId: string | null = null

  try {
    const { createSubstackClient } = await import("@workspace/core")
    const client = createSubstackClient({ sessionToken, publicationUrl })
    const self = (await client.getAuthenticatedProfile()) as {
      id?: string | number
      name?: string
      handle?: string
    }
    profileName = self?.name ?? null
    profileHandle = self?.handle ?? null
    profileId = self?.id ? String(self.id) : null
  } catch (error) {
    console.warn("Could not verify Substack credentials:", error)
  }

  const connection = await withTenant({ appUserId: appUser }, async (client) => {
    const genRes = await client.query(
      "select coalesce(max(generation), 0) + 1 as next_gen from substack_connections where user_id = $1",
      [appUser]
    )
    const nextGen = genRes.rows[0]?.next_gen ?? 1

    await client.query(
      "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status = 'active'",
      [appUser]
    )

    const connId = crypto.randomUUID()
    const inserted = await client.query(
      `insert into substack_connections
          (id, user_id, generation, status, publication_url, envelope_version,
           key_id, wrapped_key, iv, ciphertext,
           profile_id, profile_name, profile_handle, last_verified_at)
       values ($1, $2, $3, 'active', $4, 1, 'plain', 'plain', 'plain', $5, $6, $7, $8, now())
       returning id, publication_url as "publicationUrl", profile_id as "profileId",
                 profile_name as "profileName", profile_handle as "profileHandle"`,
      [connId, appUser, nextGen, publicationUrl, sessionToken, profileId, profileName, profileHandle]
    )

    await client.query(
      `insert into sync_state (connection_id, user_id, status, next_run_at)
       values ($1, $2, 'idle', now())
       on conflict (connection_id) do nothing`,
      [connId, appUser]
    )

    return inserted.rows[0]
  })

  return c.json({ connection }, 201)
})

v1.delete("/connection", async (c) => {
  const appUser = c.get("appUser")
  await withTenant({ appUserId: appUser }, async (client) => {
    await client.query(
      "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status = 'active'",
      [appUser]
    )
  })
  return c.body(null, 204)
})

v1.get("/sync", async (c) => {
  const appUser = c.get("appUser")
  const state = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select s.connection_id as "connectionId", s.status, s.cursor,
              s.last_synced_at as "lastSyncedAt", s.next_run_at as "nextRunAt",
              s.error
       from sync_state s
       join substack_connections c on c.id = s.connection_id
       where s.user_id = $1 and c.status = 'active'
       order by c.generation desc limit 1`,
      [appUser]
    )
    return res.rows[0] ?? null
  })
  return c.json({ syncState: state })
})

v1.post("/sync", async (c) => {
  const appUser = c.get("appUser")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const connId = connRes.rows[0]?.id as string | undefined
    if (!connId) return { error: "No active Substack connection" }

    // Check cooldown / existing pending or recent sync
    const checkRes = await client.query(
      `select last_synced_at
       from sync_state
       where connection_id = $1 and last_synced_at > now() - interval '60 seconds'`,
      [connId]
    )
    if (checkRes.rows.length > 0) {
      return { enqueued: false, message: "Sync was recently performed. Please wait before syncing again." }
    }

    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       values ('sync:activity', json_build_object('userId', $1::text, 'connectionId', $2::text), 'pending', now())
       returning id`,
      [appUser, connId]
    )
    return { enqueued: true, jobId: job.rows[0].id }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})

v1.get("/imports", async (c) => {
  const appUser = c.get("appUser")
  const imports = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select id, connection_id as "connectionId", status, started_at as "startedAt",
              cutoff, pages, items, new_interactions as "newInteractions",
              new_people as "newPeople", finish_reason as "finishReason", error
       from import_runs
       where user_id = $1
       order by started_at desc`,
      [appUser]
    )
    return res.rows
  })
  return c.json({ imports })
})

v1.post("/imports", async (c) => {
  const appUser = c.get("appUser")
  const body = await c.req.json().catch(() => ({}))
  const months = typeof body.months === "number" && body.months > 0 ? body.months : 3

  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const connId = connRes.rows[0]?.id as string | undefined
    if (!connId) return { error: "No active Substack connection" }

    const importRunId = crypto.randomUUID()
    await client.query(
      `insert into import_runs (id, user_id, connection_id, status, cutoff)
       values ($1, $2, $3, 'running', now() - ($4 || ' months')::interval)`,
      [importRunId, appUser, connId, months]
    )

    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       values ('import:history', json_build_object('userId', $1::text, 'connectionId', $2::text, 'importRunId', $3::text), 'pending', now())
       returning id`,
      [appUser, connId, importRunId]
    )

    return { importRunId, jobId: job.rows[0].id }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json({ enqueued: true, ...result }, 201)
})

v1.post("/imports/:id/pause", async (c) => {
  const appUser = c.get("appUser")
  const importId = c.req.param("id")
  const updated = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      "update import_runs set status = 'paused' where id = $1 and user_id = $2 and status = 'running' returning id",
      [importId, appUser]
    )
    return !!res.rows[0]
  })
  if (!updated) return c.json({ error: "Import run not found or cannot be paused" }, 400)
  return c.json({ paused: true })
})

v1.post("/imports/:id/resume", async (c) => {
  const appUser = c.get("appUser")
  const importId = c.req.param("id")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      "update import_runs set status = 'running' where id = $1 and user_id = $2 and status = 'paused' returning connection_id",
      [importId, appUser]
    )
    const connId = res.rows[0]?.connection_id as string | undefined
    if (!connId) return { error: "Import run not found or cannot be resumed" }

    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       values ('import:history', json_build_object('userId', $1::text, 'connectionId', $2::text, 'importRunId', $3::text), 'pending', now())
       returning id`,
      [appUser, connId, importId]
    )
    return { jobId: job.rows[0].id }
  })
  if ("error" in result) return c.json(result, 400)
  return c.json({ resumed: true, jobId: result.jobId })
})


