import { Pool } from "pg"

import { bootstrapRoles } from "./bootstrap-roles.js"
import { runMigrations } from "./migrate-runner.js"

async function connectWithRetry(db: Pool) {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await db.query("select 1")
      return
    } catch (error) {
      if (attempt === 30) throw error
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

const adminUrl = process.env.DATABASE_URL
if (!adminUrl) throw new Error("DATABASE_URL is required")

const appPassword = process.env.APP_DB_PASSWORD
const migratePassword = process.env.MIGRATE_DB_PASSWORD

let runUrl = adminUrl
if (appPassword && migratePassword) {
  const admin = new Pool({ connectionString: adminUrl, max: 1 })
  await connectWithRetry(admin)
  await bootstrapRoles(admin, { app: appPassword, migrate: migratePassword })
  await admin.end()

  const url = new URL(adminUrl)
  url.username = "circles_migrate"
  url.password = migratePassword
  runUrl = url.toString()
} else if (process.env.NODE_ENV === "production") {
  throw new Error(
    "APP_DB_PASSWORD and MIGRATE_DB_PASSWORD are required in production"
  )
}

const db = new Pool({ connectionString: runUrl, max: 1 })
await connectWithRetry(db)
await runMigrations(db)
await db.end()
