import { Hono } from "hono"
import { z } from "zod"
import { listComments, setCommentNotInterested } from "../../db/comments.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const commentsRoutes = new Hono<V1Env>()
const queryInput = z.object({
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(500).optional(),
  status: z.enum(["all", "pending", "not-interested"]).default("all"),
  kind: z.enum(["all", "note", "post"]).default("all"),
  excludeResponded: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
})

commentsRoutes.get("/comments", async (c) => {
  const parsed = queryInput.safeParse(c.req.query())
  if (!parsed.success) return c.json({ error: "Invalid comment filters" }, 400)
  try {
    return c.json(await withTenant({ appUserId: c.get("appUser") }, (client) =>
      listComments(client, parsed.data)))
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid cursor")
      return c.json({ error: "Invalid cursor" }, 400)
    throw error
  }
})

commentsRoutes.patch("/comments/:id", async (c) => {
  const parsed = z.object({ notInterested: z.boolean() }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid comment update" }, 400)
  const updated = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    setCommentNotInterested(client, c.req.param("id"), parsed.data.notInterested))
  if (!updated) return c.json({ error: "Comment not found" }, 404)
  return c.json({ notInterested: parsed.data.notInterested })
})
