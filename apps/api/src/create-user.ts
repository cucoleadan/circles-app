process.env.ALLOW_SIGNUP = "true"

import { auth } from "./auth.js"
import { db } from "./db.js"
import { getOrCreateAppUser } from "./db/repositories.js"

const [email, password, name] = process.argv.slice(2)

if (!email || !password) {
  console.error(
    "Usage: bun apps/api/src/create-user.ts <email> <password> [name]\n   or: bun --cwd apps/api run create-user <email> <password> [name]"
  )
  process.exit(1)
}

if (password.length < 8) {
  console.error("The password must be at least 8 characters.")
  process.exit(1)
}

try {
  const result = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: name ?? email.split("@")[0],
    },
  })
  const appUserId = await getOrCreateAppUser(result.user.id)
  console.log(`Successfully created account for ${email}:`)
  console.log(`  Auth User ID: ${result.user.id}`)
  console.log(`  App User ID:  ${appUserId}`)
} catch (err: any) {
  console.error("Failed to create user:", err?.body?.message ?? err?.message ?? err)
  process.exit(1)
} finally {
  await db.end()
}
