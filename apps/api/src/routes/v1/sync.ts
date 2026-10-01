import { Hono } from "hono"

import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const syncRoutes = new Hono<V1Env>()

function publicJobError(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null
  if (/^Substack session expired|\b401\b/i.test(value)) return "Substack session expired"
  if (/lease expired/i.test(value)) return "The worker restarted during this step; it will retry"
  if (/rate limit|\b429\b/i.test(value)) return "Substack rate limited this step; it will retry if possible"
  if (/\b403\b|rejected the audience request/i.test(value)) return "Substack rejected this request"
  return "This step failed; check the server logs for details"
}

/** Job types that run as a chain of page jobs carrying cumulative totals. */
const PAGED_STEP_TYPES = new Set(["sync:subscribers", "sync:followers"])

type ProgressStep = {
  id: string
  type: string
  status: string
  startedAt: unknown
  createdAt: unknown
  pages: number
  [key: string]: unknown
}

/**
 * Shows each paged sweep as one step. Pages run in order and each carries the
 * running totals, so the latest page holds the sweep's status, counts, and
 * error; the first page holds when the sweep started.
 */
export function collapsePagedSteps<T extends ProgressStep>(steps: T[]): T[] {
  const collapsed: T[] = []
  const chains = new Map<string, number>()
  for (const step of steps) {
    const index = PAGED_STEP_TYPES.has(step.type) ? chains.get(step.type) : undefined
    if (index === undefined) {
      if (PAGED_STEP_TYPES.has(step.type)) chains.set(step.type, collapsed.length)
      collapsed.push(step)
      continue
    }
    const first = collapsed[index]!
    collapsed[index] = {
      ...step,
      startedAt: first.startedAt ?? step.startedAt,
      createdAt: first.createdAt,
      pages: first.pages + 1,
    }
  }
  return collapsed
}

syncRoutes.get("/sync/progress", async (c) => {
  const appUser = c.get("appUser")
  const progress = await withTenant({ appUserId: appUser }, async (client) => {
    const connection = await client.query(
      `select id from substack_connections where user_id = $1 order by generation desc limit 1`,
      [appUser],
    )
    const connectionId = connection.rows[0]?.id as string | undefined
    if (!connectionId) return { run: null, lastSyncedAt: null }

    const state = await client.query(
      `select last_synced_at as "lastSyncedAt" from sync_state
       where connection_id = $1 and user_id = $2`,
      [connectionId, appUser],
    )
    const parent = await client.query(
      `select id, type, status, attempts, max_attempts as "maxAttempts",
              run_at as "runAt", locked_at as "startedAt", created_at as "createdAt",
              updated_at as "updatedAt", last_error as "lastError", result
       from jobs
       where type = 'sync:activity'
         and payload->>'userId' = $1
         and payload->>'connectionId' = $2
         and (status <> 'pending' or run_at <= now())
       order by id desc limit 1`,
      [appUser, connectionId],
    )
    const run = parent.rows[0]
    if (!run) return { run: null, lastSyncedAt: state.rows[0]?.lastSyncedAt ?? null }

    const children = await client.query(
      `select id, type, status, attempts, max_attempts as "maxAttempts",
              run_at as "runAt", locked_at as "startedAt", created_at as "createdAt",
              updated_at as "updatedAt", last_error as "lastError", result,
              payload->>'stream' as stream, payload->>'outboundStage' as "outboundStage"
       from jobs
       where payload->>'parentJobId' = $1
         and payload->>'userId' = $2
         and payload->>'connectionId' = $3
       order by id asc limit 200`,
      [String(run.id), appUser, connectionId],
    )
    const steps = collapsePagedSteps([run, ...children.rows].map((job) => ({
      id: String(job.id),
      type: job.type,
      stream: job.stream ?? null,
      outboundStage: job.outboundStage ?? null,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAt: job.runAt,
      startedAt: job.startedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.result ?? null,
      error: publicJobError(job.lastError),
      pages: 1,
    })))
    const status = steps.some((step) => step.status === "dead" || step.status === "failed") ? "failed"
      : steps.some((step) => step.status === "running" || step.status === "pending") ? "running"
        : "complete"
    return {
      run: { id: String(run.id), status, startedAt: run.createdAt, steps },
      lastSyncedAt: state.rows[0]?.lastSyncedAt ?? null,
    }
  })
  return c.json(progress)
})

syncRoutes.get("/sync", async (c) => {
  const appUser = c.get("appUser")
  const state = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select s.connection_id as "connectionId", s.status, s.cursor,
              s.last_synced_at as "lastSyncedAt", s.next_run_at as "nextRunAt",
              s.error
       from sync_state s
       join substack_connections c on c.id = s.connection_id
       where s.user_id = $1 and c.status = 'active'
       order by c.generation desc limit 1`,
      [appUser]
    )
    return res.rows[0] ?? null
  })
  return c.json({ syncState: state })
})

syncRoutes.post("/sync", async (c) => {
  const appUser = c.get("appUser")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const connId = connRes.rows[0]?.id as string | undefined
    if (!connId) return { error: "No active Substack connection" }

    // Check cooldown / existing pending or recent sync
    const checkRes = await client.query(
      `select last_synced_at
       from sync_state
       where connection_id = $1 and last_synced_at > now() - interval '60 seconds'`,
      [connId]
    )
    if (checkRes.rows.length > 0) {
      return { enqueued: false, message: "Sync was recently performed. Please wait before syncing again." }
    }

    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       select 'sync:activity', json_build_object('userId', $1::text, 'connectionId', $2::text), 'pending', now()
       where not exists (
         select 1 from jobs existing
         where existing.type = 'sync:activity'
           and (existing.status = 'running' or (existing.status = 'pending' and existing.run_at <= now()))
           and existing.payload->>'connectionId' = $2::text
       )
       returning id`,
      [appUser, connId]
    )
    if (!job.rows[0]) {
      return { enqueued: false, message: "A sync job is already in progress or queued." }
    }
    return { enqueued: true, jobId: job.rows[0].id }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})

syncRoutes.post("/sync/subscribers", async (c) => {
  const appUser = c.get("appUser")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const conn = connRes.rows[0]
    if (!conn) return { error: "No active Substack connection" }

    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       select 'sync:subscribers', json_build_object(
         'userId', $1::text, 'connectionId', $2::text, 'offset', 0,
         'runStartedAt', $3::text, 'manual', true
       ), 'pending', now()
       where not exists (
         select 1 from jobs existing
         where existing.type = 'sync:subscribers'
           and existing.status in ('pending', 'running')
           and existing.payload->>'connectionId' = $2::text
       )
       returning id`,
      [appUser, conn.id, new Date().toISOString()]
    )
    if (!job.rows[0]) {
      return { enqueued: false, message: "A subscriber sync is already queued or running." }
    }
    return { enqueued: true, jobId: job.rows[0].id }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})

syncRoutes.post("/sync/followers", async (c) => {
  const appUser = c.get("appUser")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const conn = connRes.rows[0]
    if (!conn) return { error: "No active Substack connection" }

    const runStartedAt = new Date().toISOString()
    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       select 'sync:followers', json_build_object(
         'userId', $1::text, 'connectionId', $2::text,
         'runStartedAt', $3::text, 'fullSweep', true, 'manual', true, 'limit', 20
       ), 'pending', now()
       where not exists (
         select 1 from jobs existing
         where existing.type = 'sync:followers'
           and existing.status in ('pending', 'running')
           and existing.payload->>'connectionId' = $2::text
           and existing.payload->>'fullSweep' = 'true'
       )
       returning id`,
      [appUser, conn.id, runStartedAt]
    )
    if (!job.rows[0]) {
      return { enqueued: false, message: "A full follower sweep is already queued or running." }
    }
    return { enqueued: true, jobId: job.rows[0].id }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})
