import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { installFetchTimeout } from "@workspace/core"
import { claimAndRunJob } from "./jobs.js"
import { MAINTENANCE_INTERVAL_MS, runQueueMaintenance } from "./maintenance.js"

const dedicatedUrl = process.env.APP_DATABASE_URL
const baseUrl = process.env.DATABASE_URL
const appPassword = process.env.APP_DB_PASSWORD
let connectionString = dedicatedUrl
if (!connectionString) {
  if (!baseUrl) throw new Error("APP_DATABASE_URL or DATABASE_URL is required")
  if (appPassword) {
    const url = new URL(baseUrl)
    url.username = "circles_app"
    url.password = appPassword
    connectionString = url.toString()
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_DATABASE_URL is required in production so the worker connects as the limited circles_app role"
    )
  } else {
    connectionString = baseUrl
  }
}

installFetchTimeout()

const db = new Pool({
  connectionString,
  max: 4,
  connectionTimeoutMillis: 10_000,
  // Jobs that still read Substack inside a transaction are bounded by the
  // 30-second fetch timeout; anything idle far longer is a stuck handler.
  idle_in_transaction_session_timeout: 120_000,
  statement_timeout: 120_000,
})
const workerId = randomUUID()
let isRunning = true
let nextMaintenanceAt = 0

console.log(`[Circles Worker ${workerId}] Starting background queue runner...`)

async function loop() {
  while (isRunning) {
    try {
      if (Date.now() >= nextMaintenanceAt) {
        nextMaintenanceAt = Date.now() + MAINTENANCE_INTERVAL_MS
        await runQueueMaintenance(db)
      }
      const didWork = await claimAndRunJob(db, workerId)
      // One worker process owns the queue loop. Keep a gap after every
      // authenticated job so independently scheduled streams cannot burst the
      // same Substack session back-to-back.
      await new Promise((resolve) => setTimeout(resolve, didWork ? 1000 : 3000))
    } catch (err) {
      console.error("[Circles Worker] Loop iteration error:", err)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}

// Start worker queue loop
loop().catch((err) => console.error("[Circles Worker] Fatal loop error:", err))

async function shutdown() {
  console.log("[Circles Worker] Shutting down gracefully...")
  isRunning = false
  await db.end()
  process.exit(0)
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
