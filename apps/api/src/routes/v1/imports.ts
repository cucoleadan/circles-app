import { Hono } from "hono"

import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const importsRoutes = new Hono<V1Env>()

importsRoutes.get("/imports", async (c) => {
  const appUser = c.get("appUser")
  const imports = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select id, connection_id as "connectionId", status, started_at as "startedAt",
              cutoff, pages, items, new_interactions as "newInteractions",
              new_people as "newPeople", finish_reason as "finishReason", error,
              coalesce((select json_agg(json_build_object(
                'stream', s.stream, 'status', s.status, 'pages', s.pages,
                'items', s.items, 'newInteractions', s.new_interactions,
                'newPeople', s.new_people, 'completeness', s.completeness,
                'finishReason', s.finish_reason, 'error', s.error
              ) order by s.stream)
              from import_run_streams s where s.import_run_id = r.id), '[]'::json) as streams
       from import_runs r
       where user_id = $1
       order by started_at desc`,
      [appUser]
    )
    return res.rows
  })
  return c.json({ imports })
})

importsRoutes.post("/imports", async (c) => {
  const appUser = c.get("appUser")
  const body = await c.req.json().catch(() => ({}))
  const months = typeof body.months === "number" && body.months > 0 ? body.months : 3
  const full = body.full === true

  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const connId = connRes.rows[0]?.id as string | undefined
    if (!connId) return { error: "No active Substack connection" }

    // Automatically pause any existing running import runs for this connection and remove their pending jobs
    const existingRunning = await client.query(
      "select id from import_runs where user_id = $1 and connection_id = $2 and status = 'running'",
      [appUser, connId]
    )
    for (const prior of existingRunning.rows) {
      await client.query(
        "update import_runs set status = 'paused', finish_reason = 'superceded' where id = $1",
        [prior.id]
      )
      await client.query(
        "update import_run_streams set status = 'paused', finish_reason = 'superceded', updated_at = now() where import_run_id = $1 and status = 'running'",
        [prior.id]
      )
      await client.query(
        "delete from jobs where type = 'import:history' and status = 'pending' and payload->>'importRunId' = $1",
        [prior.id]
      )
    }

    const importRunId = crypto.randomUUID()
    await client.query(
      `insert into import_runs (id, user_id, connection_id, status, cutoff)
       values ($1, $2, $3, 'running', case when $4::boolean then '1970-01-01'::timestamptz else now() - ($5 || ' months')::interval end)`,
      [importRunId, appUser, connId, full, months]
    )

    await client.query(
      `insert into import_run_streams
          (import_run_id, user_id, connection_id, stream, status, completeness, finish_reason)
       values
          ($1, $2, $3, 'activity', 'running', 'partial', null),
          ($1, $2, $3, 'owned_notes', 'running', 'partial', null),
          ($1, $2, $3, 'owned_posts', 'running', 'partial', null),
          ($1, $2, $3, 'outbound_actions', 'running', 'partial', null)`,
      [importRunId, appUser, connId],
    )

    const jobs = await client.query(
      `insert into jobs (type, payload, status, run_at)
       select 'import:history',
              json_build_object('userId', $1::text, 'connectionId', $2::text, 'importRunId', $3::text, 'stream', stream),
              'pending', now() + (position * interval '2 seconds')
       from unnest(array['activity', 'owned_notes', 'owned_posts', 'outbound_actions'])
         with ordinality as queued(stream, position)
       returning id`,
      [appUser, connId, importRunId],
    )

    const jobIds = jobs.rows.map((row) => row.id)
    return { importRunId, jobId: jobIds[0], jobIds }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json({ enqueued: true, ...result }, 201)
})

importsRoutes.post("/imports/:id/pause", async (c) => {
  const appUser = c.get("appUser")
  const importId = c.req.param("id")
  const updated = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      "update import_runs set status = 'paused' where id = $1 and user_id = $2 and status = 'running' returning id",
      [importId, appUser]
    )
    if (!res.rows[0]) return false
    await client.query(
      "update import_run_streams set status = 'paused', updated_at = now() where import_run_id = $1 and status = 'running'",
      [importId],
    )
    await client.query(
      "delete from jobs where type = 'import:history' and status = 'pending' and payload->>'importRunId' = $1",
      [importId]
    )
    return true
  })
  if (!updated) return c.json({ error: "Import run not found or cannot be paused" }, 400)
  return c.json({ paused: true })
})

importsRoutes.post("/imports/:id/cancel", async (c) => {
  const appUser = c.get("appUser")
  const importId = c.req.param("id")
  const updated = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      "update import_runs set status = 'paused', finish_reason = 'cancelled' where id = $1 and user_id = $2 returning id",
      [importId, appUser]
    )
    if (!res.rows[0]) return false
    await client.query(
      "update import_run_streams set status = 'paused', finish_reason = 'cancelled', updated_at = now() where import_run_id = $1 and status in ('running', 'paused')",
      [importId],
    )
    await client.query(
      "delete from jobs where type = 'import:history' and status = 'pending' and payload->>'importRunId' = $1",
      [importId]
    )
    return true
  })
  if (!updated) return c.json({ error: "Import run not found or cannot be cancelled" }, 400)
  return c.json({ cancelled: true })
})

importsRoutes.post("/imports/:id/resume", async (c) => {
  const appUser = c.get("appUser")
  const importId = c.req.param("id")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      "update import_runs set status = 'running' where id = $1 and user_id = $2 and status = 'paused' returning connection_id",
      [importId, appUser]
    )
    const connId = res.rows[0]?.connection_id as string | undefined
    if (!connId) return { error: "Import run not found or cannot be resumed" }

    const streams = await client.query(
      `update import_run_streams set status = 'running', updated_at = now()
       where import_run_id = $1 and status = 'paused' returning stream`,
      [importId],
    )
    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       select 'import:history',
              json_build_object('userId', $1::text, 'connectionId', $2::text, 'importRunId', $3::text, 'stream', stream),
              'pending', now()
       from unnest($4::text[]) as stream
       returning id`,
      [appUser, connId, importId, streams.rows.map((row) => row.stream)],
    )
    const jobIds = job.rows.map((row) => row.id)
    return { jobId: jobIds[0], jobIds }
  })
  if ("error" in result) return c.json(result, 400)
  return c.json({ resumed: true, jobId: result.jobId, jobIds: result.jobIds })
})
