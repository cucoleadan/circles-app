import { Hono } from "hono"
import { z } from "zod"

import {
  addListMember,
  audit,
  createList,
  deleteList,
  listLists,
  removeListMember,
  updateList,
} from "../../db/repositories.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const listsRoutes = new Hono<V1Env>()

const namedInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
})

listsRoutes.get("/lists", async (c) => {
  const lists = await withTenant({ appUserId: c.get("appUser") }, listLists)
  return c.json({ lists })
})

listsRoutes.post("/lists", async (c) => {
  const parsed = namedInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid list" }, 400)
  const appUser = c.get("appUser")
  const list = await withTenant({ appUserId: appUser }, async (client) => {
    const created = await createList(client, appUser, parsed.data.name, parsed.data.description)
    await audit(client, appUser, "list.create", "list", created.id)
    return created
  })
  return c.json({ list }, 201)
})

listsRoutes.patch("/lists/:listId", async (c) => {
  const parsed = namedInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid list" }, 400)
  const appUser = c.get("appUser")
  const listId = c.req.param("listId")
  const list = await withTenant({ appUserId: appUser }, async (client) => {
    const updated = await updateList(client, listId, parsed.data.name, parsed.data.description)
    if (updated) {
      await audit(client, appUser, "list.update", "list", listId)
    }
    return updated
  })
  if (!list) return c.json({ error: "List not found" }, 404)
  return c.json({ list })
})

listsRoutes.delete("/lists/:listId", async (c) => {
  const appUser = c.get("appUser")
  const listId = c.req.param("listId")
  const deleted = await withTenant({ appUserId: appUser }, async (client) => {
    const ok = await deleteList(client, listId)
    if (ok) {
      await audit(client, appUser, "list.delete", "list", listId)
    }
    return ok
  })
  if (!deleted) return c.json({ error: "List not found" }, 404)
  return c.body(null, 204)
})

listsRoutes.post("/lists/:listId/members", async (c) => {
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

listsRoutes.delete("/lists/:listId/members/:personId", async (c) => {
  await withTenant({ appUserId: c.get("appUser") }, (client) =>
    removeListMember(client, c.req.param("listId"), c.req.param("personId"))
  )
  return c.body(null, 204)
})
