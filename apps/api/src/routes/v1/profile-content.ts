import { Hono } from "hono"
import { z } from "zod"
import { listProfileContent } from "../../db/profile-content.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const profileContentRoutes = new Hono<V1Env>()

const id = z.string().min(1).max(100)
const queryInput = z.object({
  personId: id.optional(),
  listId: id.optional(),
  kind: z.enum(["all", "note", "reply", "restack", "post"]).default("all"),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1000).optional(),
}).refine((value) => !(value.personId && value.listId), { message: "Pass personId or listId, not both" })

/** Stored Notes and posts of contacts; defaults to the Watched Profiles list. */
profileContentRoutes.get("/profile-content", async (c) => {
  const parsed = queryInput.safeParse(c.req.query())
  if (!parsed.success) return c.json({ error: "Invalid content filters" }, 400)
  try {
    return c.json(await withTenant({ appUserId: c.get("appUser") }, (client) =>
      listProfileContent(client, parsed.data)))
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid cursor")
      return c.json({ error: "Invalid cursor" }, 400)
    throw error
  }
})
