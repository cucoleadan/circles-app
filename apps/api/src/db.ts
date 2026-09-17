import { Pool } from "pg"

export function runtimeDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl) throw new Error("DATABASE_URL is required")

  const password = process.env.APP_DB_PASSWORD
  if (!password) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "APP_DB_PASSWORD is required in production so the service connects as the limited circles_app role"
      )
    return baseUrl
  }

  const url = new URL(baseUrl)
  url.username = "circles_app"
  url.password = password
  return url.toString()
}

export const db = new Pool({
  connectionString: runtimeDatabaseUrl(),
  max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
})
