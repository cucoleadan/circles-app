import { Hono } from "hono"

import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const syncRoutes = new Hono<V1Env>()

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
           and existing.status in ('pending', 'running')
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
