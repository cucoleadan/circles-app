import { randomUUID } from "node:crypto"

import { Pool } from "pg"

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
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
