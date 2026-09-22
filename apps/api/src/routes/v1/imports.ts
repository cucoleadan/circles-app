import { Hono } from "hono"

import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const importsRoutes = new Hono<V1Env>()

const historyStreams = ["activity", "outbound_actions", "owned_notes", "owned_posts"] as const
const audienceStreams = ["subscribers", "followers"] as const
const allowedStreams = new Set<string>([...historyStreams, ...audienceStreams])

function selectedStreams(body: any): string[] {
  if (!Array.isArray(body.streams)) return [...historyStreams]
  const requested: unknown[] = body.streams
  return [...new Set(requested.filter((stream): stream is string =>
    typeof stream === "string" && allowedStreams.has(stream)
  ))]
}

function audienceCheckpoint(cursor: unknown) {
  if (typeof cursor !== "string" || !cursor) return {}
  try { return JSON.parse(cursor) as Record<string, unknown> } catch { return {} }
}

async function enqueueStream(
  client: any,
  userId: string,
  connectionId: string,
  importRunId: string,
  stream: string,
  cursor: unknown = null,
  delay = 0,
) {
  const checkpoint = audienceCheckpoint(cursor)
  const type = stream === "subscribers"
    ? "sync:subscribers"
    : stream === "followers" ? "sync:followers" : "import:history"
  const runStartedAt = typeof checkpoint.runStartedAt === "string"
    ? checkpoint.runStartedAt
    : new Date().toISOString()
  const payload = {
    userId,
    connectionId,
    importRunId,
    stream,
    ...(stream === "subscribers" && {
      offset: Number(checkpoint.offset ?? 0), runStartedAt,
    }),
    ...(stream === "followers" && {
      runStartedAt, fullSweep: true, limit: 20,
    }),
  }
  const job = await client.query(
    `insert into jobs (type, payload, status, run_at)
     values ($1, $2, 'pending', now() + ($3 || ' seconds')::interval)
     returning id`,
    [type, JSON.stringify(payload), delay],
  )
  return job.rows[0]?.id
}

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
              ) order by array_position(
                array['activity', 'outbound_actions', 'owned_notes', 'owned_posts', 'subscribers', 'followers'],
                s.stream
              ))
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
  const streams = selectedStreams(body)
  if (streams.length === 0) return c.json({ error: "Select at least one stream" }, 400)

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
        "delete from jobs where type in ('import:history', 'sync:subscribers', 'sync:followers') and status = 'pending' and payload->>'importRunId' = $1",
        [prior.id]
      )
    }

    const importRunId = crypto.randomUUID()
    const full = body.full === true
    let cutoffExpr = "now() - interval '3 months'"
    const cutoffParams: unknown[] = [importRunId, appUser, connId]

    if (full) {
      cutoffExpr = "'1970-01-01'::timestamptz"
    } else if (typeof body.cutoffDate === "string" && body.cutoffDate.trim().length > 0) {
      const cutoff = new Date(body.cutoffDate)
      if (Number.isNaN(cutoff.getTime())) return { error: "Invalid cutoff date" }
      cutoffParams.push(cutoff.toISOString())
      cutoffExpr = `$${cutoffParams.length}::timestamptz`
    } else if (typeof body.days === "number" && body.days > 0) {
      cutoffParams.push(Math.round(body.days))
      cutoffExpr = `now() - ($${cutoffParams.length} || ' days')::interval`
    } else if (typeof body.months === "number" && body.months > 0) {
      cutoffParams.push(Math.round(body.months))
      cutoffExpr = `now() - ($${cutoffParams.length} || ' months')::interval`
    }

    await client.query(
      `insert into import_runs (id, user_id, connection_id, status, cutoff)
       values ($1, $2, $3, 'running', ${cutoffExpr})`,
      cutoffParams
    )

    await client.query(
      `insert into import_run_streams
          (import_run_id, user_id, connection_id, stream, status, completeness, finish_reason)
       select $1, $2, $3, stream, 'running', 'partial', null
       from unnest($4::text[]) as stream`,
      [importRunId, appUser, connId, streams],
    )

    const jobIds: string[] = []
    for (const [index, stream] of streams.entries()) {
      const jobId = await enqueueStream(client, appUser, connId, importRunId, stream, null, index * 2)
      if (jobId) jobIds.push(jobId)
    }
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
      "delete from jobs where type in ('import:history', 'sync:subscribers', 'sync:followers') and status = 'pending' and payload->>'importRunId' = $1",
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
      "delete from jobs where type in ('import:history', 'sync:subscribers', 'sync:followers') and status = 'pending' and payload->>'importRunId' = $1",
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
       where import_run_id = $1 and status = 'paused' returning stream, cursor`,
      [importId],
    )
    const jobIds: string[] = []
    for (const row of streams.rows) {
      const jobId = await enqueueStream(client, appUser, connId, importId, row.stream, row.cursor)
      if (jobId) jobIds.push(jobId)
    }
    return { jobId: jobIds[0], jobIds }
  })
  if ("error" in result) return c.json(result, 400)
  return c.json({ resumed: true, jobId: result.jobId, jobIds: result.jobIds })
})
