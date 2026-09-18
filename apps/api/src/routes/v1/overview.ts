import { Hono } from "hono"

import { circlesOverview } from "../../db/repositories.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const overviewRoutes = new Hono<V1Env>()

overviewRoutes.get("/circles", async (c) => {
  const overview = await withTenant({ appUserId: c.get("appUser") }, circlesOverview)
  return c.json(overview)
})
