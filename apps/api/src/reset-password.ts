import { hashPassword } from "better-auth/crypto"

import { db } from "./db.js"

const [email, password] = process.argv.slice(2)

if (!email || !password) {
  console.error(
    "Usage: bun apps/api/dist/reset-password.js <email> <new-password>"
  )
  process.exit(1)
}
if (password.length < 8) {
  console.error("The new password must be at least 8 characters.")
  process.exit(1)
}

const hash = await hashPassword(password)
const account = await db.query(
  `update "account" set password = $1, "updatedAt" = now()
    where "providerId" = 'credential'
      and "userId" in (select id from "user" where email = $2)`,
  [hash, email]
)
if (!account.rowCount) {
  console.error(`No credential account found for ${email}.`)
  await db.end()
  process.exit(1)
}

await db.query(
  `delete from "session"
    where "userId" in (select id from "user" where email = $1)`,
  [email]
)
console.log(`Password updated for ${email} and all sessions revoked.`)
await db.end()
