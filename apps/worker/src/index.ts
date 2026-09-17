import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { claimAndRunJob } from "./jobs.js"

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

const db = new Pool({ connectionString, max: 4 })
const workerId = randomUUID()
let isRunning = true

console.log(`[Circles Worker ${workerId}] Starting background queue runner...`)

async function loop() {
  while (isRunning) {
    try {
      const didWork = await claimAndRunJob(db, workerId)
      if (!didWork) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
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
