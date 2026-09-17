// Must be imported first: points the repository pool at the throwaway test
// database before any module that opens a connection is evaluated.
const adminUrl = new URL(
  process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5433/circles_crm"
)
const appPassword = process.env.APP_DB_PASSWORD
const migratePassword = process.env.MIGRATE_DB_PASSWORD

if (!appPassword || !migratePassword)
  throw new Error("APP_DB_PASSWORD and MIGRATE_DB_PASSWORD are required for tests")

export const testDatabaseName = "circles_test"

export const testAdminUrl = adminUrl.toString()

export const testAppUrl = (() => {
  const url = new URL(adminUrl)
  url.pathname = `/${testDatabaseName}`
  url.username = "circles_app"
  url.password = appPassword
  return url.toString()
})()

export const testMigrateUrl = (() => {
  const url = new URL(adminUrl)
  url.pathname = `/${testDatabaseName}`
  url.username = "circles_migrate"
  url.password = migratePassword
  return url.toString()
})()

process.env.APP_DATABASE_URL = testAppUrl
