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

const personInput = z.object({
  name: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(120).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  relationshipStatus: relationshipStatus.optional().nullable(),
  substackProfileId: z.string().max(200).optional().nullable(),
  profileUrl: z.string().url().max(500).optional().nullable(),
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

peopleRoutes.patch("/people/:personId", async (c) => {
  const parsed = personInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid person" }, 400)
  const person = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    updatePerson(client, c.req.param("personId"), parsed.data)
  )
  if (!person) return c.json({ error: "Person not found" }, 404)
  return c.json({ person })
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
