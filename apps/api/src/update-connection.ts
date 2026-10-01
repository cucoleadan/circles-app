import { db } from "./db.js"
import { replaceSubstackConnection, verifySubstackSession } from "./db/connections.js"
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
  const profile = await verifySubstackSession(sessionToken, publicationUrl)
  console.log(`Verified Substack profile: ${profile.name} (@${profile.handle}) [ID: ${profile.id}]`)

  const conn = await withTenant({ appUserId }, (tClient) =>
    replaceSubstackConnection(tClient, appUserId, {
      sessionToken,
      publicationUrl: publicationUrl ?? null,
      profile,
    })
  )

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
