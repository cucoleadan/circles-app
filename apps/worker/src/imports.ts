import type { PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  normalizeActivityPage,
  type ActivityItemInput,
  openSessionToken,
} from "@workspace/core"
import {
  syncOwnedNotesPage,
  syncOwnedPostsPage,
  syncOutboundActionsPage,
} from "./history.js"
import { withTenant } from "./tenant.js"
import { preserveActivityEvidence, type HistoryStream } from "./activity.js"

export async function finishImportIfReady(client: PoolClient, importRunId: string) {
  await client.query(
    `with totals as (
       select coalesce(sum(pages), 0)::int as pages,
              coalesce(sum(items), 0)::int as items,
              coalesce(sum(new_interactions), 0)::int as new_interactions,
              coalesce(sum(new_people), 0)::int as new_people,
              bool_and(status in ('complete', 'unavailable', 'failed')) as finished,
              bool_or(status = 'failed') as failed
       from import_run_streams where import_run_id = $1
     )
     update import_runs r
     set pages = totals.pages,
         items = totals.items,
         new_interactions = totals.new_interactions,
         new_people = totals.new_people,
         status = case
           when r.status = 'paused' then 'paused'
           when totals.finished and totals.failed then 'failed'
           when totals.finished then 'complete'
           else 'running'
         end,
         finish_reason = case when totals.finished then 'all_streams_finished' else r.finish_reason end
     from totals where r.id = $1`,
    [importRunId],
  )
}

export async function processHistoryImport(
  client: PoolClient,
  userId: string,
  importRunId: string,
  stream: HistoryStream = "activity",
) {
  return withTenant(client, userId, async () => {
    // 1. Fetch import run
    const runRes = await client.query(
      `select id, connection_id, status, cutoff
       from import_runs
       where id = $1 and user_id = $2`,
      [importRunId, userId]
    )
    const run = runRes.rows[0]
    if (!run || run.status !== "running") {
      return { completed: true, status: run?.status ?? "not_found" }
    }

    const streamRes = await client.query(
      `select stream, status, cursor, pages, items, new_interactions, new_people
       from import_run_streams where import_run_id = $1 and stream = $2 and user_id = $3`,
      [importRunId, stream, userId],
    )
    const streamRun = streamRes.rows[0]
    if (!streamRun || streamRun.status !== "running") {
      await finishImportIfReady(client, importRunId)
      return { completed: true, status: streamRun?.status ?? "not_found" }
    }

    // 2. Fetch connection
    const connRes = await client.query(
      `select key_id, iv, ciphertext, publication_url, profile_handle, profile_id, status
       from substack_connections
       where id = $1 and user_id = $2`,
      [run.connection_id, userId]
    )
    const conn = connRes.rows[0]
    if (!conn || conn.status !== "active") {
      await client.query(
        "update import_runs set status = 'failed', finish_reason = 'connection_inactive', error = 'Substack connection is inactive or expired' where id = $1",
        [importRunId]
      )
      await client.query(
        `update import_run_streams
         set status = 'failed', finish_reason = 'connection_inactive',
             error = 'Substack connection is inactive or expired', updated_at = now()
         where import_run_id = $1 and status = 'running'`,
        [importRunId],
      )
      return { completed: true, status: "failed" }
    }

    const sdk = createSubstackClient({
      sessionToken: openSessionToken(conn),
      publicationUrl: conn.publication_url,
    })

    try {
      if (stream === "owned_notes") {
        const result = await syncOwnedNotesPage(
          client,
          sdk,
          {
            userId,
            connectionId: run.connection_id,
            ownerHandle: conn.profile_handle,
            ownerId: conn.profile_id,
            source: "import",
          },
          streamRun.cursor,
          1,
          new Date(run.cutoff),
        )
        await client.query(
          `update import_run_streams
           set pages = pages + 1, items = items + $3,
               new_interactions = new_interactions + $4, new_people = new_people + $5,
               cursor = $6, status = case when $7 then 'complete' else 'running' end,
               completeness = case when $7 then 'complete' else 'partial' end,
               finish_reason = case when $7 then 'exhausted' else finish_reason end,
               error = null, updated_at = now()
           where import_run_id = $1 and stream = $2`,
          [importRunId, stream, result.items, result.newInteractions, result.newPeople, result.nextCursor, result.complete],
        )
        await finishImportIfReady(client, importRunId)
        return { completed: result.complete, nextCursor: result.nextCursor, stats: result }
      }

      if (stream === "owned_posts") {
        const result = await syncOwnedPostsPage(
          client,
          sdk,
          {
            userId,
            connectionId: run.connection_id,
            ownerHandle: conn.profile_handle,
            ownerId: conn.profile_id,
            source: "import",
          },
          streamRun.cursor,
          1,
          new Date(run.cutoff),
        )
        await client.query(
          `update import_run_streams
           set pages = pages + 1, items = items + $3,
               new_interactions = new_interactions + $4, new_people = new_people + $5,
               cursor = $6, status = case when $7 then 'complete' else 'running' end,
               completeness = case when $7 then 'complete' else 'partial' end,
               finish_reason = case when $7 then 'exhausted' else finish_reason end,
               error = null, updated_at = now()
           where import_run_id = $1 and stream = $2`,
          [importRunId, stream, result.items, result.newInteractions, result.newPeople, result.nextCursor, result.complete],
        )
        await finishImportIfReady(client, importRunId)
        return { completed: result.complete, nextCursor: result.nextCursor, stats: result }
      }

      if (stream === "outbound_actions") {
        const result = await syncOutboundActionsPage(
          client,
          sdk,
          {
            userId,
            connectionId: run.connection_id,
            ownerHandle: conn.profile_handle,
            ownerId: conn.profile_id,
            source: "import",
          },
          streamRun.cursor,
          20,
          new Date(run.cutoff),
        )
        await client.query(
          `update import_run_streams
           set pages = pages + 1, items = items + $3,
               new_interactions = new_interactions + $4, new_people = new_people + $5,
               cursor = $6, status = case when $7 then 'complete' else 'running' end,
               completeness = case when $7 then 'complete' else 'partial' end,
               finish_reason = case when $7 then 'all_outbound_sources_finished' else finish_reason end,
               error = null, updated_at = now()
           where import_run_id = $1 and stream = $2`,
          [importRunId, stream, result.items, result.newInteractions, result.newPeople, result.nextCursor, result.complete],
        )
        await finishImportIfReady(client, importRunId)
        return { completed: result.complete, nextCursor: result.nextCursor, stats: result }
      }

      const activityPage: any = await sdk.getActivityPage({
        after: streamRun.cursor || undefined,
      })

      const items: ActivityItemInput[] = normalizeActivityPage(activityPage)
      await preserveActivityEvidence(client, userId, run.connection_id, "import", activityPage)

      const stats = await ingestActivityBatch(client, {
        userId,
        connectionId: run.connection_id,
        ownerHandle: conn.profile_handle,
        ownerId: conn.profile_id,
        items,
        source: "import",
      })

      const nextCursor = activityPage?.nextAfter ?? activityPage?.nextCursor ?? null
      const cutoffDate = new Date(run.cutoff)
      let hitCutoff = false
      let oldestTimestamp: string | null = null
      for (const item of items) {
        const ts = item.created_at || item.createdAt || item.updated_at
        if (!ts) continue
        const itemDate = new Date(ts)
        if (Number.isNaN(itemDate.getTime())) continue
        if (!oldestTimestamp || itemDate < new Date(oldestTimestamp)) oldestTimestamp = itemDate.toISOString()
        if (itemDate <= cutoffDate) hitCutoff = true
      }
      const isDone = hitCutoff || items.length === 0 || !nextCursor
      await client.query(
        `update import_run_streams
         set pages = pages + 1, items = items + $3,
             new_interactions = new_interactions + $4, new_people = new_people + $5,
             cursor = $6, status = case when $7 then 'complete' else 'running' end,
             completeness = case when $7 then 'complete' else 'partial' end,
             finish_reason = case when $7 and $8 then 'cutoff_reached' when $7 then 'exhausted' else finish_reason end,
             error = null, updated_at = now()
         where import_run_id = $1 and stream = $2`,
        [importRunId, stream, stats.processedItems, stats.newInteractions, stats.newPeople, nextCursor, isDone, hitCutoff],
      )
      if (oldestTimestamp) {
        await client.query("update import_runs set oldest_at = $2 where id = $1", [importRunId, oldestTimestamp])
      }
      await finishImportIfReady(client, importRunId)
      return { completed: isDone, nextCursor, stats }
    } catch (err: any) {
      if (err?.statusCode === 401 || err?.message?.includes("401")) {
        await client.query(
          "update substack_connections set status = 'expired', updated_at = now() where id = $1",
          [run.connection_id]
        )
        await client.query(
          `update import_run_streams
           set status = 'failed', finish_reason = 'session_expired', error = 'Substack session expired', updated_at = now()
           where import_run_id = $1 and stream = $2`,
          [importRunId, stream],
        )
        await finishImportIfReady(client, importRunId)
        return { completed: true, status: "failed" }
      }
      throw err
    }
  })
}
