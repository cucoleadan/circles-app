import { Pool } from "pg"

export function runtimeDatabaseUrl(): string {
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL

  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl) throw new Error("APP_DATABASE_URL or DATABASE_URL is required")

  const password = process.env.APP_DB_PASSWORD
  if (!password) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "APP_DATABASE_URL is required in production so the service connects as the limited circles_app role"
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
  // Fail a request instead of queueing forever when every connection is busy.
  connectionTimeoutMillis: 10_000,
  // Postgres ends sessions that sit idle inside a transaction, so a stalled
  // handler cannot pin row locks or a pool slot indefinitely.
  idle_in_transaction_session_timeout: 60_000,
  statement_timeout: 60_000,
})
