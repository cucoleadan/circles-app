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
