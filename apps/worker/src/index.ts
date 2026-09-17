import { randomUUID } from "node:crypto"
import { Pool, type PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  type ActivityItemInput,
} from "@workspace/core"

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

async function withTenant<T>(
  client: PoolClient,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  await client.query("begin")
  try {
    await client.query("select set_config('app.user_id', $1, true)", [userId])
    const result = await fn()
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  }
}

async function processActivitySync(
  client: PoolClient,
  userId: string,
  connectionId: string
) {
  return withTenant(client, userId, async () => {
    // 1. Fetch connection details
    const connRes = await client.query(
      `select id, ciphertext, publication_url, profile_id, profile_handle, status
       from substack_connections
       where id = $1 and user_id = $2`,
      [connectionId, userId]
    )
    const conn = connRes.rows[0]
    if (!conn || conn.status !== "active") {
      console.log(`[Circles Worker] Connection ${connectionId} is no longer active; skipping sync.`)
      return { skipped: true }
    }

    const sessionToken = conn.ciphertext
    const publicationUrl = conn.publication_url
    const ownerHandle = conn.profile_handle
    const ownerId = conn.profile_id

    // 2. Fetch cursor from sync_state
    const syncRes = await client.query(
      "select cursor from sync_state where connection_id = $1",
      [connectionId]
    )
    const currentCursor = syncRes.rows[0]?.cursor as string | undefined

    // 3. Fetch activity from Substack
    const sdk = createSubstackClient({ sessionToken, publicationUrl })
    let activityPage: any
    try {
      activityPage = await sdk.getActivityPage({
        after: currentCursor || undefined,
      })
    } catch (err: any) {
      if (err?.statusCode === 401 || err?.message?.includes("401")) {
        console.warn(`[Circles Worker] Session expired for connection ${connectionId}.`)
        await client.query(
          "update substack_connections set status = 'expired', updated_at = now() where id = $1",
          [connectionId]
        )
        await client.query(
          "update sync_state set status = 'error', error = 'Substack session expired', updated_at = now() where connection_id = $1",
          [connectionId]
        )
        throw new Error("Substack session expired")
      }
      throw err
    }

    const items: ActivityItemInput[] = Array.isArray(activityPage?.results)
      ? activityPage.results
      : Array.isArray(activityPage)
      ? activityPage
      : []

    // 4. Ingest items into interactions & refresh people
    const stats = await ingestActivityBatch(client, {
      userId,
      connectionId,
      ownerHandle,
      ownerId,
      items,
      source: "sdk",
    })

    const nextCursor = activityPage?.nextCursor ?? currentCursor ?? null

    // 5. Update sync_state
    await client.query(
      `update sync_state
       set cursor = coalesce($2, cursor),
           last_synced_at = now(),
           next_run_at = now() + interval '15 minutes',
           status = 'idle',
           error = null,
           updated_at = now()
       where connection_id = $1`,
      [connectionId, nextCursor]
    )

    console.log(
      `[Circles Worker] Synced connection ${connectionId}: ${stats.processedItems} items processed, ` +
        `${stats.newInteractions} new interactions, ${stats.newPeople} new contacts.`
    )

    return { skipped: false, stats }
  })
}

async function claimAndRunJob(): Promise<boolean> {
  const client = await db.connect()
  try {
    // Reset expired leases
    await client.query(
      `update jobs
       set status = 'pending', run_at = now()
       where status = 'running' and lease_expires_at < now()`
    )

    // Claim next pending job
    await client.query("begin")
    const claimRes = await client.query(
      `select id, type, payload, attempts, max_attempts
       from jobs
       where status = 'pending' and run_at <= now()
       order by run_at, id
       limit 1
       for update skip locked`
    )

    const job = claimRes.rows[0]
    if (!job) {
      await client.query("commit")
      return false
    }

    const leaseToken = randomUUID()
    await client.query(
      `update jobs
       set status = 'running',
           attempts = attempts + 1,
           locked_at = now(),
           locked_by = $2,
           lease_token = $3,
           lease_expires_at = now() + interval '5 minutes',
           updated_at = now()
       where id = $1`,
      [job.id, workerId, leaseToken]
    )
    await client.query("commit")

    // Execute job
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload
    const { userId, connectionId } = payload

    try {
      if (job.type === "sync:activity") {
        const result = await processActivitySync(client, userId, connectionId)

        // Reschedule next recurring sync if connection is still active
        if (!result.skipped) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:activity', $1, 'pending', now() + interval '15 minutes')`,
            [JSON.stringify(payload)]
          )
        }
      }

      // Mark job done
      await client.query(
        "update jobs set status = 'done', updated_at = now() where id = $1 and lease_token = $2",
        [job.id, leaseToken]
      )
    } catch (jobError: any) {
      console.error(`[Circles Worker] Job ${job.id} (${job.type}) failed:`, jobError.message)
      const isDead =
        job.attempts + 1 >= job.max_attempts ||
        jobError.message?.includes("expired")

      if (isDead) {
        await client.query(
          "update jobs set status = 'dead', last_error = $2, updated_at = now() where id = $1",
          [job.id, jobError.message]
        )
      } else {
        const retryDelaySeconds = Math.min(300, (job.attempts + 1) * 30)
        await client.query(
          `update jobs
           set status = 'pending',
               run_at = now() + ($2 || ' seconds')::interval,
               last_error = $3,
               updated_at = now()
           where id = $1`,
          [job.id, retryDelaySeconds, jobError.message]
        )
      }
    }

    return true
  } finally {
    client.release()
  }
}

async function loop() {
  while (isRunning) {
    try {
      const didWork = await claimAndRunJob()
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
