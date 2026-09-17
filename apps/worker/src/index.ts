import { randomUUID } from "node:crypto"

import { Pool } from "pg"

const baseUrl = process.env.DATABASE_URL
if (!baseUrl) throw new Error("DATABASE_URL is required")

const appPassword = process.env.APP_DB_PASSWORD
let connectionString = baseUrl
if (appPassword) {
  const url = new URL(baseUrl)
  url.username = "circles_app"
  url.password = appPassword
  connectionString = url.toString()
} else if (process.env.NODE_ENV === "production") {
  throw new Error(
    "APP_DB_PASSWORD is required in production so the worker connects as the limited circles_app role"
  )
}

const db = new Pool({ connectionString, max: 2 })
const workerId = randomUUID()

async function tick() {
  await db.query("select 1")
  console.log(`Worker ${workerId} ready`)
}

await tick()
const timer = setInterval(tick, 60_000)

async function shutdown() {
  clearInterval(timer)
  await db.end()
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
