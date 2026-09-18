import { createHash, randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  normalizeActivityPage,
  type ActivityItemInput,
} from "@workspace/core"
import {
  replayOwnedNoteSnapshots,
  syncOutboundActionsPage,
  syncOwnedNotesPage,
  syncOwnedPostsPage,
  syncRecentOutboundActions,
  type OutboundStage,
} from "./history.js"

type HistoryStream = "activity" | "owned_notes" | "owned_posts" | "outbound_actions"
type ScheduledHistoryStream = Exclude<HistoryStream, "activity">

async function preserveActivityEvidence(
  client: PoolClient,
  userId: string,
  connectionId: string,
  source: "sdk" | "import",
  payload: unknown,
) {
  const raw = JSON.stringify(payload)
  const dedupeKey = createHash("sha256").update(`${connectionId}:${source}:${raw}`).digest("hex")
  await client.query(
    `insert into ingestion_batches
        (id, user_id, source, dedupe_key, payload, status, received_at, processed_at)
     values ($1, $2, $3, $4, $5, 'processed', now(), now())
     on conflict (user_id, dedupe_key) do nothing`,
    [randomUUID(), userId, source, dedupeKey, raw],
  )
  await client.query(
    `insert into activity_snapshots (connection_id, schema_version, payload, captured_at)
     values ($1, 1, $2, now())
     on conflict (connection_id) do update set payload = excluded.payload, captured_at = now()`,
    [connectionId, raw],
  )
}

async function finishImportIfReady(client: PoolClient, importRunId: string) {
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

export async function withTenant<T>(
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

export async function processActivitySync(
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

    // Scheduled sync always reads the newest page and relies on stable IDs for
    // dedupe. Historical cursors belong exclusively to resumable backfills.
    const sdk = createSubstackClient({ sessionToken, publicationUrl })
    let activityPage: any
    try {
      activityPage = await sdk.getActivityPage()
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

    const items: ActivityItemInput[] = normalizeActivityPage(activityPage)
    await preserveActivityEvidence(client, userId, connectionId, "sdk", activityPage)

    // 4. Ingest items into interactions & refresh people
    const stats = await ingestActivityBatch(client, {
      userId,
      connectionId,
      ownerHandle,
      ownerId,
      items,
      source: "sdk",
    })

    const nextCursor = activityPage?.nextAfter ?? activityPage?.nextCursor ?? null

    await client.query(
      `insert into sync_stream_state
          (connection_id, user_id, stream, status, cursor, last_synced_at, completeness, error, updated_at)
       values ($1, $2, 'activity', 'idle', $3, now(), 'partial', null, now())
       on conflict (connection_id, stream) do update
         set status = 'idle', cursor = excluded.cursor, last_synced_at = now(), error = null, updated_at = now()`,
      [connectionId, userId, nextCursor],
    )

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

export async function processScheduledHistorySync(
  client: PoolClient,
  userId: string,
  connectionId: string,
  stream: ScheduledHistoryStream,
  outboundStage?: OutboundStage,
) {
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select ciphertext, publication_url, profile_handle, profile_id, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active") return { skipped: true }

    await client.query(
      `insert into sync_stream_state (connection_id, user_id, stream, status, completeness, updated_at)
       values ($1, $2, $3, 'running', 'partial', now())
       on conflict (connection_id, stream) do update
         set status = 'running', error = null, updated_at = now()`,
      [connectionId, userId, stream],
    )

    const sdk = createSubstackClient({
      sessionToken: conn.ciphertext,
      publicationUrl: conn.publication_url,
    })
    const context = {
      userId,
      connectionId,
      ownerHandle: conn.profile_handle,
      ownerId: conn.profile_id,
      source: "sdk" as const,
    }
    const result = stream === "owned_notes"
      ? await syncOwnedNotesPage(client, sdk, context, null, 1)
      : stream === "owned_posts"
        ? await syncOwnedPostsPage(client, sdk, context, null, 1)
        : await syncRecentOutboundActions(client, sdk, context, 20, outboundStage)

    await client.query(
      `update sync_stream_state
       set status = 'idle', last_synced_at = now(), completeness = 'partial',
           finish_reason = 'recent_window', error = null, updated_at = now()
       where connection_id = $1 and stream = $2`,
      [connectionId, stream],
    )
    return { skipped: false, stats: result }
  })
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
      `select ciphertext, publication_url, profile_handle, profile_id, status
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
      sessionToken: conn.ciphertext,
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

export async function processProfileEnrichment(
  client: PoolClient,
  userId: string,
  personId: string
) {
  return withTenant(client, userId, async () => {
    // 1. Fetch person details
    const personRes = await client.query(
      `select id, handle, normalized_handle, substack_profile_id, name
       from people
       where id = $1 and user_id = $2 and archived_at is null`,
      [personId, userId]
    )
    const person = personRes.rows[0]
    if (!person || !person.normalized_handle) return { skipped: true }

    // 2. Fetch active connection
    const connRes = await client.query(
      `select id, ciphertext, publication_url
       from substack_connections
       where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId]
    )
    const conn = connRes.rows[0]
    if (!conn) return { skipped: true }

    // 3. Try to fetch profile via Substack SDK or public reader API
    try {
      const sdk = createSubstackClient({
        sessionToken: conn.ciphertext,
        publicationUrl: conn.publication_url,
      })
      let profileData: any = null
      try {
        if (typeof (sdk as any).getProfile === "function") {
          profileData = await (sdk as any).getProfile(person.normalized_handle)
        }
      } catch {
        // SDK might not support getProfile directly
      }

      // 4. Update profile_snapshots
      await client.query(
        `insert into profile_snapshots
            (person_id, user_id, connection_id, schema_version, payload, fetched_at, last_attempted_at)
         values ($1, $2, $3, 1, $4, now(), now())
         on conflict (person_id) do update
          set connection_id = excluded.connection_id,
              payload = coalesce(excluded.payload, profile_snapshots.payload),
              fetched_at = case when excluded.payload is not null then now() else profile_snapshots.fetched_at end,
              last_attempted_at = now(),
              last_error = null`,
        [personId, userId, conn.id, profileData ? JSON.stringify(profileData) : null]
      )

      // 5. Monotonic enrichment on people table
      if (profileData?.name && (!person.name || person.name === person.handle)) {
        await client.query(
          "update people set name = $1, updated_at = now() where id = $2 and user_id = $3",
          [profileData.name, personId, userId]
        )
      }

      return { success: true }
    } catch (err: any) {
      await client.query(
        `insert into profile_snapshots
            (person_id, user_id, connection_id, schema_version, last_attempted_at, last_error)
         values ($1, $2, $3, 1, now(), $4)
         on conflict (person_id) do update
          set last_attempted_at = now(),
              last_error = excluded.last_error`,
        [personId, userId, conn.id, err?.message || "Unknown error"]
      )
      return { success: false, error: err?.message }
    }
  })
}

export async function processStoredNoteReplay(
  client: PoolClient,
  userId: string,
  connectionId: string,
  afterNoteId?: string | null,
) {
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select profile_id, profile_handle, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active") return { completed: true, nextCursor: null }
    const result = await replayOwnedNoteSnapshots(client, {
      userId,
      connectionId,
      ownerId: conn.profile_id,
      ownerHandle: conn.profile_handle,
      source: "import",
    }, afterNoteId)
    return { completed: result.complete, nextCursor: result.nextCursor }
  })
}

export interface JobHandlers {
  onSync?: (client: PoolClient, userId: string, connectionId: string) => Promise<{ skipped: boolean }>
  onHistorySync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    stream: ScheduledHistoryStream,
    outboundStage?: OutboundStage,
  ) => Promise<{ skipped: boolean }>
  onImport?: (client: PoolClient, userId: string, importRunId: string, stream?: HistoryStream) => Promise<{ completed: boolean }>
  onEnrich?: (client: PoolClient, userId: string, personId: string) => Promise<unknown>
}

export async function claimAndRunJob(
  pool: Pool,
  workerId: string,
  handlers?: JobHandlers
): Promise<boolean> {
  const client = await pool.connect()
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
    const { userId, connectionId, importRunId, personId, stream, outboundStage } = payload

    try {
      if (job.type === "sync:activity") {
        const result = handlers?.onSync
          ? await handlers.onSync(client, userId, connectionId)
          : await processActivitySync(client, userId, connectionId)
        if (!result.skipped) {
          const scheduledHistory: Array<{
            stream: ScheduledHistoryStream
            outboundStage?: OutboundStage
            delay: number
          }> = [
            { stream: "owned_notes", delay: 10 },
            { stream: "owned_posts", delay: 20 },
            { stream: "outbound_actions", outboundStage: "likes", delay: 30 },
            { stream: "outbound_actions", outboundStage: "restacks", delay: 40 },
            { stream: "outbound_actions", outboundStage: "replies", delay: 50 },
          ]
          for (const scheduled of scheduledHistory) {
            await client.query(
              `insert into jobs (type, payload, status, run_at)
               select 'sync:history', $1, 'pending', now() + ($2 || ' seconds')::interval
               where not exists (
                 select 1 from jobs existing
                 where existing.type = 'sync:history'
                   and existing.status in ('pending', 'running')
                   and existing.payload->>'connectionId' = $3
                   and existing.payload->>'stream' = $4
                   and coalesce(existing.payload->>'outboundStage', '') = $5
               )`,
              [
                JSON.stringify({ ...payload, stream: scheduled.stream, outboundStage: scheduled.outboundStage }),
                scheduled.delay,
                connectionId,
                scheduled.stream,
                scheduled.outboundStage ?? "",
              ],
            )
          }
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:activity', $1, 'pending', now() + interval '15 minutes')`,
            [JSON.stringify(payload)]
          )
        }
      } else if (job.type === "sync:history") {
        const result = handlers?.onHistorySync
          ? await handlers.onHistorySync(client, userId, connectionId, stream, outboundStage)
          : await processScheduledHistorySync(client, userId, connectionId, stream, outboundStage)
        if (result.skipped) {
          console.log(`[Circles Worker] Skipped ${stream} sync for inactive connection ${connectionId}.`)
        }
      } else if (job.type === "import:history") {
        const result = handlers?.onImport
          ? await handlers.onImport(client, userId, importRunId, stream)
          : await processHistoryImport(client, userId, importRunId, stream)
        if (!result.completed) {
          // Keep pages small and spaced out; other streams share the same
          // authenticated Substack session and are interleaved by this queue.
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('import:history', $1, 'pending', now() + interval '10 seconds')`,
            [JSON.stringify(payload)]
          )
        }
      } else if (job.type === "enrich:profile") {
        if (handlers?.onEnrich) {
          await handlers.onEnrich(client, userId, personId)
        } else {
          await processProfileEnrichment(client, userId, personId)
        }
      } else if (job.type === "reprocess:note-snapshots") {
        const result = await processStoredNoteReplay(
          client,
          userId,
          connectionId,
          payload.afterNoteId ?? null,
        )
        if (!result.completed) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('reprocess:note-snapshots', $1, 'pending', now() + interval '10 seconds')`,
            [JSON.stringify({ ...payload, afterNoteId: result.nextCursor })],
          )
        }
      } else {
        throw new Error(`Unknown job type: ${job.type}`)
      }

      // Mark job done
      await client.query(
        "update jobs set status = 'done', last_error = null, updated_at = now() where id = $1 and lease_token = $2",
        [job.id, leaseToken]
      )
    } catch (jobError: any) {
      console.error(`[Circles Worker] Job ${job.id} (${job.type}) failed:`, jobError.message)
      const isRateLimited = jobError?.status === 429 ||
        jobError?.statusCode === 429 ||
        String(jobError?.message || "").includes("429")
      const isDead = (
        !isRateLimited && job.attempts + 1 >= job.max_attempts
      ) || jobError.message?.includes("expired")

      if (isDead) {
        await client.query(
          "update jobs set status = 'dead', last_error = $2, updated_at = now() where id = $1",
          [job.id, jobError.message]
        )
        if (job.type === "import:history" && userId && importRunId) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update import_run_streams
               set status = 'failed', finish_reason = 'retry_limit', error = $3, updated_at = now()
               where import_run_id = $1 and stream = $2 and status = 'running'`,
              [importRunId, stream ?? "activity", jobError.message],
            )
            await finishImportIfReady(client, importRunId)
          })
        }
      } else {
        const retryDelaySeconds = isRateLimited
          ? Math.min(1800, 60 * (2 ** Math.min(job.attempts, 5)))
          : Math.min(300, (job.attempts + 1) * 30)
        await client.query(
          `update jobs
           set status = 'pending',
               run_at = now() + ($2 || ' seconds')::interval,
               last_error = $3,
               updated_at = now()
           where id = $1`,
          [job.id, retryDelaySeconds, jobError.message]
        )
        if (job.type === "import:history" && userId && importRunId) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update import_run_streams
               set error = $3, updated_at = now()
               where import_run_id = $1 and stream = $2 and status = 'running'`,
              [
                importRunId,
                stream ?? "activity",
                isRateLimited
                  ? `Substack rate limit; retrying in ${retryDelaySeconds} seconds`
                  : jobError.message,
              ],
            )
          })
        } else if (job.type === "sync:history" && userId && connectionId && stream) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update sync_stream_state
               set status = 'error', error = $3, updated_at = now()
               where connection_id = $1 and stream = $2`,
              [
                connectionId,
                stream,
                isRateLimited
                  ? `Substack rate limit; retrying in ${retryDelaySeconds} seconds`
                  : jobError.message,
              ],
            )
          })
        }
      }
    }

    return true
  } finally {
    client.release()
  }
}
