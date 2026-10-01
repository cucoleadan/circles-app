import { Hono } from "hono"
import { z } from "zod"

import {
  replaceSubstackConnection,
  SubstackVerificationError,
  verifySubstackSession,
} from "../../db/connections.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const connectionRoutes = new Hono<V1Env>()

connectionRoutes.get("/connection", async (c) => {
  const appUser = c.get("appUser")
  const conn = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select id, publication_url as "publicationUrl",
              profile_id as "profileId", profile_name as "profileName",
              profile_handle as "profileHandle",
              status, last_verified_at as "lastVerifiedAt",
              created_at as "createdAt"
       from substack_connections
       where user_id = $1 and status != 'revoked'
       order by generation desc limit 1`,
      [appUser]
    )
    return res.rows[0] ?? null
  })
  return c.json({ connection: conn })
})

connectionRoutes.post("/connection", async (c) => {
  const appUser = c.get("appUser")
  const input = z
    .object({
      sessionToken: z.string().trim().min(1),
      publicationUrl: z.string().trim().url().optional().nullable(),
    })
    .safeParse(await c.req.json())
  if (!input.success) return c.json({ error: "Invalid connection payload" }, 400)

  const { sessionToken, publicationUrl } = input.data

  let profile
  try {
    profile = await verifySubstackSession(sessionToken, publicationUrl)
  } catch (error) {
    if (error instanceof SubstackVerificationError) return c.json({ error: error.message }, 400)
    throw error
  }

  const connection = await withTenant({ appUserId: appUser }, (client) =>
    replaceSubstackConnection(client, appUser, {
      sessionToken,
      publicationUrl: publicationUrl ?? null,
      profile,
    })
  )

  return c.json({ connection }, 201)
})

connectionRoutes.delete("/connection", async (c) => {
  const appUser = c.get("appUser")
  await withTenant({ appUserId: appUser }, async (client) => {
    await client.query(
      "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status = 'active'",
      [appUser]
    )
  })
  return c.body(null, 204)
})
