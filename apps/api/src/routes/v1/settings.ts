import { Hono } from "hono"

import { getUserSettings, updateUserSettings } from "../../db/repositories.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const settingsRoutes = new Hono<V1Env>()

settingsRoutes.get("/me", (c) => c.json({ appUser: c.get("appUser") }))

settingsRoutes.get("/settings", async (c) => {
  const settings = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    getUserSettings(client)
  )
  return c.json({ settings })
})

settingsRoutes.patch("/settings", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const settings = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    updateUserSettings(client, body)
  )
  return c.json({ settings })
})
