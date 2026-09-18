import { Hono } from "hono"
import { z } from "zod"

import {
  attachTag,
  audit,
  createTag,
  deleteTag,
  detachTag,
  listTags,
  updateTag,
} from "../../db/repositories.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const tagsRoutes = new Hono<V1Env>()

const tagInput = z.object({
  name: z.string().trim().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
})

tagsRoutes.get("/tags", async (c) => {
  const tags = await withTenant({ appUserId: c.get("appUser") }, listTags)
  return c.json({ tags })
})

tagsRoutes.post("/tags", async (c) => {
  const parsed = tagInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid tag" }, 400)
  const tag = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    createTag(client, c.get("appUser"), parsed.data.name, parsed.data.color)
  )
  return c.json({ tag }, 201)
})

tagsRoutes.patch("/tags/:tagId", async (c) => {
  const parsed = tagInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: "Invalid tag" }, 400)
  const tag = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    updateTag(client, c.req.param("tagId"), parsed.data.name, parsed.data.color)
  )
  if (!tag) return c.json({ error: "Tag not found" }, 404)
  return c.json({ tag })
})

tagsRoutes.delete("/tags/:tagId", async (c) => {
  const appUser = c.get("appUser")
  const deleted = await withTenant({ appUserId: appUser }, (client) =>
    deleteTag(client, c.req.param("tagId"))
  )
  if (!deleted) return c.json({ error: "Tag not found" }, 404)
  return c.body(null, 204)
})

tagsRoutes.post("/tags/:tagId/people", async (c) => {
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

tagsRoutes.delete("/tags/:tagId/people/:personId", async (c) => {
  await withTenant({ appUserId: c.get("appUser") }, (client) =>
    detachTag(client, c.req.param("tagId"), c.req.param("personId"))
  )
  return c.body(null, 204)
})
