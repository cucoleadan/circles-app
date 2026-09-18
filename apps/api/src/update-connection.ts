import { createSubstackClient } from "@workspace/core"
import { db } from "./db.js"
import { withTenant } from "./db/tenant.js"

const [email, sessionToken, publicationUrl] = process.argv.slice(2)

if (!email || !sessionToken) {
  console.error(
    "Usage: bun apps/api/src/update-connection.ts <email> <sessionToken> [publicationUrl]\n   or: bun --cwd apps/api run update-connection <email> <sessionToken> [publicationUrl]"
  )
  process.exit(1)
}

try {
  const userRes = await db.query('select id, name, email from "user" where lower(email) = lower($1)', [email])
  if (!userRes.rows[0]) {
    console.error(`User with email "${email}" not found in database.`)
    process.exit(1)
  }
  const authUser = userRes.rows[0]

  const appUserRes = await db.query('select id from app_users where auth_user_id = $1', [authUser.id])
  if (!appUserRes.rows[0]) {
    console.error(`No app_users record found for ${email}.`)
    process.exit(1)
  }
  const appUserId = appUserRes.rows[0].id

  console.log(`Verifying Substack session token for ${authUser.name ?? email}…`)
  const client = createSubstackClient({ sessionToken, publicationUrl })
  const self = (await client.getAuthenticatedProfile()) as {
    id?: string | number
    name?: string
    handle?: string
  }

  const profileName = self?.name ?? null
  const profileHandle = self?.handle ?? null
  const profileId = self?.id ? String(self.id) : null

  console.log(`Verified Substack profile: ${profileName} (@${profileHandle}) [ID: ${profileId}]`)

  const conn = await withTenant({ appUserId }, async (tClient) => {
    const genRes = await tClient.query(
      "select coalesce(max(generation), 0) + 1 as next_gen from substack_connections where user_id = $1",
      [appUserId]
    )
    const nextGen = genRes.rows[0]?.next_gen ?? 1

    await tClient.query(
      "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status in ('active', 'expired')",
      [appUserId]
    )

    const connId = crypto.randomUUID()
    const inserted = await tClient.query(
      `insert into substack_connections
          (id, user_id, generation, status, publication_url, envelope_version,
           key_id, wrapped_key, iv, ciphertext,
           profile_id, profile_name, profile_handle, last_verified_at)
       values ($1, $2, $3, 'active', $4, 1, 'plain', 'plain', 'plain', $5, $6, $7, $8, now())
       returning id, publication_url as "publicationUrl", profile_id as "profileId",
                 profile_name as "profileName", profile_handle as "profileHandle"`,
      [connId, appUserId, nextGen, publicationUrl ?? null, sessionToken, profileId, profileName, profileHandle]
    )

    await tClient.query(
      `insert into sync_state (connection_id, user_id, status, next_run_at)
       values ($1, $2, 'idle', now())
       on conflict (connection_id) do update set status = 'idle', error = null, updated_at = now()`,
      [connId, appUserId]
    )

    return inserted.rows[0]
  })

  console.log("Successfully updated Substack connection:")
  console.log("  Connection ID:", conn.id)
  console.log("  Profile Name:", conn.profileName)
  console.log("  Profile Handle:", conn.profileHandle)
  console.log("  Status: active")
} catch (err: any) {
  console.error("Failed to update connection:", err?.message || err)
  process.exit(1)
} finally {
  await db.end()
}
