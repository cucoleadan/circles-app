import { randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { Pool } from "pg"
import { installFetchTimeout, runtimeDatabaseUrl } from "@workspace/core"
import { recordFailure, sendAlert, unhealthyReason } from "./health.js"
import { claimAndRunJob } from "./jobs.js"
import { MAINTENANCE_INTERVAL_MS, runQueueMaintenance } from "./maintenance.js"

installFetchTimeout()

const db = new Pool({
  connectionString: runtimeDatabaseUrl(),
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
    const unhealthy = unhealthyReason()
    if (unhealthy) {
      console.error(`[Circles Worker] Unhealthy, restarting: ${unhealthy}`)
      await sendAlert(`${unhealthy}. Restarting the worker.`)
      // Non-zero exit hands recovery to Docker's restart policy.
      isRunning = false
      await db.end().catch(() => {})
      process.exit(1)
    }
    try {
      if (Date.now() >= nextMaintenanceAt) {
        nextMaintenanceAt = Date.now() + MAINTENANCE_INTERVAL_MS
        await runQueueMaintenance(db)
      }
      const didWork = await claimAndRunJob(db, workerId)
      // One worker process owns the queue loop. Keep a gap after every
      // authenticated job so independently scheduled streams cannot burst the
      // same Substack session back-to-back.
      await sleep(didWork ? 1000 : 3000)
    } catch (err) {
      console.error("[Circles Worker] Loop iteration error:", err)
      recordFailure(String((err as Error)?.message ?? err))
      await sleep(5000)
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
