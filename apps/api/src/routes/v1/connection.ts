import { Hono } from "hono"
import { z } from "zod"

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
      "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status in ('active', 'expired')",
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
                 profile_name as "profileName", profile_handle as "profileHandle",
                 status, last_verified_at as "lastVerifiedAt"`,
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
