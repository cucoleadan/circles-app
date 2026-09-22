import { createHash, randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  normalizeActivityPage,
  parseFollowerRunStartedAt,
  parseSubscriberStatsPage,
  reconcileSubscriberSnapshot,
  shouldAbortFollowerSweep,
  upsertSubscribersBatch,
  type ActivityItemInput,
} from "@workspace/core"
import {
  normalizeOutboundProfileFeed,
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

function substackResponseError(message: string, status: number) {
  const error = new Error(`${message} (${status})`) as Error & { status: number }
  error.status = status
  return error
}

export async function processSubscriberSyncPage(
  client: PoolClient,
  userId: string,
  connectionId: string,
  offset = 0,
  runStartedAtValue?: unknown,
) {
  const runStartedAt = parseFollowerRunStartedAt(runStartedAtValue)
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select ciphertext, publication_url, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active") return { completed: true, skipped: true }
    const publicationUrl = String(conn.publication_url ?? "").replace(/\/$/, "")
    if (!publicationUrl) throw new Error("Publication URL is not set on the active connection")

    const response = await fetch(`${publicationUrl}/api/v1/subscriber-stats`, {
      method: "POST",
      headers: {
        cookie: `substack.sid=${conn.ciphertext}`,
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ limit: 100, offset }),
    })
    if (!response.ok) throw substackResponseError("Substack subscriber API failed", response.status)

    const page = parseSubscriberStatsPage(await response.json())
    const batch = await upsertSubscribersBatch(
      client,
      userId,
      page.subscribers,
      new Date().toISOString(),
    )
    const nextOffset = offset + page.received
    const completed = page.received === 0 || nextOffset >= page.total
    const deactivated = completed
      ? await reconcileSubscriberSnapshot(client, userId, runStartedAt.toISOString())
      : 0
    return {
      completed,
      skipped: false,
      nextOffset,
      total: page.total,
      processed: page.subscribers.length,
      matched: batch.matched,
      created: batch.created,
      invalid: page.skipped + batch.skipped,
      deactivated,
      runStartedAt: runStartedAt.toISOString(),
    }
  })
}

export async function processFollowerSyncBatch(
  client: PoolClient,
  userId: string,
  connectionId: string,
  runStartedAtValue: unknown,
  limit = 20,
) {
  const runStartedAt = parseFollowerRunStartedAt(runStartedAtValue)
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select ciphertext, publication_url, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active") {
      return { completed: true, skipped: true, checked: 0, updated: 0, failed: 0, remaining: 0 }
    }
    const sdk = createSubstackClient({
      sessionToken: conn.ciphertext,
      publicationUrl: conn.publication_url,
    })
    const people = await client.query(
      `select p.id, p.normalized_handle, p.substack_profile_id
       from people p
       left join relationship_stats s on s.person_id = p.id
       where p.user_id = $1 and p.archived_at is null
         and (p.normalized_handle is not null or p.substack_profile_id is not null)
         and (p.follower_checked_at is null or p.follower_checked_at < $3::timestamptz)
       order by p.follower_checked_at asc nulls first,
                coalesce(s.engagement_score, 0) desc, p.id
       limit $2`,
      [userId, Math.max(1, Math.min(limit, 50)), runStartedAt.toISOString()],
    )

    let updated = 0
    let failed = 0
    for (const person of people.rows) {
      try {
        const profile: any = person.normalized_handle
          ? await sdk.getPublicProfile(person.normalized_handle)
          : await sdk.getProfileById(person.substack_profile_id)
        if (typeof profile?.followsViewer === "boolean") {
          await client.query(
            `update people set is_follower = $2, follower_checked_at = now(), updated_at = now()
             where id = $1`,
            [person.id, profile.followsViewer],
          )
          updated++
        } else {
          failed++
          await client.query("update people set follower_checked_at = now() where id = $1", [person.id])
        }
      } catch (error) {
        if (shouldAbortFollowerSweep(error)) throw error
        failed++
        await client.query("update people set follower_checked_at = now() where id = $1", [person.id])
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    const progress = await client.query(
      `select count(*) filter (
         where follower_checked_at is null or follower_checked_at < $2::timestamptz
       )::int as remaining
       from people
       where user_id = $1 and archived_at is null
         and (normalized_handle is not null or substack_profile_id is not null)`,
      [userId, runStartedAt.toISOString()],
    )
    const remaining = progress.rows[0]?.remaining ?? 0
    return {
      completed: remaining === 0,
      skipped: false,
      checked: people.rows.length,
      updated,
      failed,
      remaining,
      runStartedAt: runStartedAt.toISOString(),
    }
  })
}

async function recordAudienceImportProgress(
  client: PoolClient,
  userId: string,
  importRunId: string,
  stream: "subscribers" | "followers",
  result: any,
) {
  return withTenant(client, userId, async () => {
    const checked = Number(stream === "subscribers" ? result.processed : result.checked) || 0
    const newPeople = Number(stream === "subscribers" ? result.created : 0) || 0
    const invalid = Number(stream === "subscribers" ? result.invalid : result.failed) || 0
    const cursor = JSON.stringify({
      runStartedAt: result.runStartedAt,
      ...(stream === "subscribers" && { offset: result.nextOffset }),
    })
    const warning = invalid > 0
      ? `${invalid} ${stream === "subscribers" ? "subscriber records" : "profiles"} could not be verified`
      : null
    const updated = await client.query(
      `update import_run_streams
       set pages = pages + 1, items = items + $3, new_people = new_people + $4,
           cursor = $5,
           status = case when $6 then 'failed' when $7 then 'complete' else 'running' end,
           completeness = case when $7 and not $6 then 'complete' else 'partial' end,
           finish_reason = case when $6 then 'connection_inactive'
                                when $7 then 'current_state_checked' else finish_reason end,
           error = case when $6 then 'Substack connection is inactive or expired' else $8 end,
           updated_at = now()
       where import_run_id = $1 and stream = $2 and status = 'running'
       returning status`,
      [importRunId, stream, checked, newPeople, cursor, result.skipped === true, result.completed === true, warning],
    )
    await finishImportIfReady(client, importRunId)
    return updated.rows[0]?.status === "running"
  })
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

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
    const allItems: ActivityItemInput[] = normalizeActivityPage(activityPage)
    await preserveActivityEvidence(client, userId, connectionId, "sdk", activityPage)

    // Only ingest items occurring within the past 15 minutes for periodic sync
    const items = allItems.filter((item) => {
      const ts = item.created_at || item.createdAt || item.updated_at
      if (!ts) return false
      const d = new Date(ts)
      return !Number.isNaN(d.getTime()) && d >= fifteenMinutesAgo
    })

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
    const recentCutoff = new Date(Date.now() - 15 * 60 * 1000)
    const result = stream === "owned_notes"
      ? await syncOwnedNotesPage(client, sdk, context, null, 1, recentCutoff)
      : stream === "owned_posts"
        ? await syncOwnedPostsPage(client, sdk, context, null, 1, recentCutoff)
        : await syncRecentOutboundActions(client, sdk, context, 20, outboundStage, recentCutoff)

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
      const enrichedPhoto =
        profileData?.photo_url ||
        profileData?.photoUrl ||
        profileData?.avatar_url ||
        profileData?.avatarUrl ||
        null
      if (enrichedPhoto) {
        await client.query(
          "update people set avatar_url = $1, updated_at = now() where id = $2 and user_id = $3 and (avatar_url is null or avatar_url = '')",
          [enrichedPhoto, personId, userId]
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

export async function processStoredInteractionEvidence(
  client: PoolClient,
  userId: string,
  connectionId: string,
  cursor?: { activityDone?: boolean; afterReceivedAt?: string | null; afterBatchId?: string | null },
) {
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select profile_id, profile_handle, status, created_at
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active" || !conn.profile_id) {
      return { completed: true, cursor: null }
    }

    const context = {
      userId,
      connectionId,
      ownerId: String(conn.profile_id),
      ownerHandle: conn.profile_handle ?? null,
    }

    if (!cursor?.activityDone) {
      const snapshot = await client.query(
        `select payload from activity_snapshots
         where connection_id = $1 order by captured_at desc limit 1`,
        [connectionId],
      )
      if (snapshot.rows[0]?.payload) {
        await ingestActivityBatch(client, {
          ...context,
          items: normalizeActivityPage(snapshot.rows[0].payload),
          source: "import",
        })
      }
    }

    const page = await client.query(
      `select id, source, payload, received_at
       from ingestion_batches
       where user_id = $1
         and received_at >= $2
         and (payload ? 'profileFeedStage' or payload ? 'activityItems')
         and ($3::timestamptz is null or (received_at, id) > ($3::timestamptz, $4::text))
       order by received_at, id
       limit 10`,
      [userId, conn.created_at, cursor?.afterReceivedAt ?? null, cursor?.afterBatchId ?? ""],
    )

    for (const row of page.rows) {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
      const stage = payload?.profileFeedStage
      const items = stage === "likes" || stage === "restacks"
        ? normalizeOutboundProfileFeed(
            Array.isArray(payload?.page?.items) ? payload.page.items : [],
            context.ownerId,
          )
        : normalizeActivityPage(payload)
      await ingestActivityBatch(client, {
        ...context,
        items,
        source: row.source === "sdk" ? "sdk" : "import",
      })
    }

    const last = page.rows.at(-1)
    return {
      completed: page.rows.length < 10,
      cursor: last
        ? {
            activityDone: true,
            afterReceivedAt: new Date(last.received_at).toISOString(),
            afterBatchId: String(last.id),
          }
        : null,
    }
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
  onSubscriberSync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    offset: number,
    runStartedAt: unknown,
  ) => Promise<any>
  onFollowerSync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    runStartedAt: unknown,
    limit: number,
  ) => Promise<any>
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
    const {
      userId, connectionId, importRunId, personId, stream, outboundStage,
      offset, runStartedAt, fullSweep, limit,
    } = payload

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
          const audienceJobs = [
            {
              type: "sync:subscribers",
              delay: 60,
              payload: {
                userId,
                connectionId,
                offset: 0,
                runStartedAt: new Date().toISOString(),
                manual: false,
              },
            },
            {
              type: "sync:followers",
              delay: 70,
              payload: {
                userId,
                connectionId,
                runStartedAt: new Date().toISOString(),
                fullSweep: false,
                manual: false,
                limit: 50,
              },
            },
          ]
          for (const audience of audienceJobs) {
            await client.query(
              `insert into jobs (type, payload, status, run_at)
               select $1, $2, 'pending', now() + ($3 || ' seconds')::interval
               where not exists (
                 select 1 from jobs existing
                 where existing.type = $1
                   and existing.status in ('pending', 'running')
                   and existing.payload->>'connectionId' = $4
               )`,
              [
                audience.type,
                JSON.stringify(audience.payload),
                audience.delay,
                connectionId,
              ],
            )
          }
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             select 'sync:activity', $1, 'pending', now() + interval '15 minutes'
             where not exists (
               select 1 from jobs existing
               where existing.type = 'sync:activity'
                 and existing.status in ('pending', 'running')
                 and existing.payload->>'connectionId' = $2
             )`,
            [JSON.stringify(payload), connectionId]
          )
        }
      } else if (job.type === "sync:history") {
        const result = handlers?.onHistorySync
          ? await handlers.onHistorySync(client, userId, connectionId, stream, outboundStage)
          : await processScheduledHistorySync(client, userId, connectionId, stream, outboundStage)
        if (result.skipped) {
          console.log(`[Circles Worker] Skipped ${stream} sync for inactive connection ${connectionId}.`)
        }
      } else if (job.type === "sync:subscribers") {
        const result = handlers?.onSubscriberSync
          ? await handlers.onSubscriberSync(client, userId, connectionId, Number(offset ?? 0), runStartedAt)
          : await processSubscriberSyncPage(client, userId, connectionId, Number(offset ?? 0), runStartedAt)
        const totals = {
          processed: Number(payload.processed ?? 0) + Number(result.processed ?? 0),
          matched: Number(payload.matched ?? 0) + Number(result.matched ?? 0),
          created: Number(payload.created ?? 0) + Number(result.created ?? 0),
          invalid: Number(payload.invalid ?? 0) + Number(result.invalid ?? 0),
          deactivated: Number(payload.deactivated ?? 0) + Number(result.deactivated ?? 0),
        }
        const continueImport = importRunId && stream === "subscribers"
          ? await recordAudienceImportProgress(client, userId, importRunId, stream, result)
          : !result.completed && !result.skipped
        if (continueImport) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:subscribers', $1, 'pending', now() + interval '2 seconds')`,
            [JSON.stringify({
              ...payload,
              offset: result.nextOffset,
              total: result.total,
              runStartedAt: result.runStartedAt ?? runStartedAt,
              ...totals,
            })],
          )
        } else if (!result.skipped) {
          console.log(
            `[Circles Worker] Subscriber sync complete: ${totals.processed} processed, ` +
              `${totals.matched} matched, ${totals.created} created, ` +
              `${totals.deactivated} unsubscribed, ${totals.invalid} skipped.`,
          )
        }
      } else if (job.type === "sync:followers") {
        const result = handlers?.onFollowerSync
          ? await handlers.onFollowerSync(client, userId, connectionId, runStartedAt, Number(limit ?? 20))
          : await processFollowerSyncBatch(client, userId, connectionId, runStartedAt, Number(limit ?? 20))
        const totals = {
          checked: Number(payload.checked ?? 0) + Number(result.checked ?? 0),
          updated: Number(payload.updated ?? 0) + Number(result.updated ?? 0),
          failed: Number(payload.failed ?? 0) + Number(result.failed ?? 0),
        }
        const continueImport = importRunId && stream === "followers"
          ? await recordAudienceImportProgress(client, userId, importRunId, stream, result)
          : fullSweep === true && !result.completed && !result.skipped
        if (continueImport) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:followers', $1, 'pending', now() + interval '5 seconds')`,
            [JSON.stringify({
              ...payload,
              runStartedAt: result.runStartedAt ?? runStartedAt,
              ...totals,
            })],
          )
        } else if (!result.skipped) {
          console.log(
            `[Circles Worker] Follower sync ${fullSweep === true ? "complete" : "batch complete"}: ` +
              `${totals.checked} checked, ${totals.updated} updated, ${totals.failed} unverifiable.`,
          )
        }
      } else if (job.type === "import:history") {
        const result = handlers?.onImport
          ? await handlers.onImport(client, userId, importRunId, stream)
          : await processHistoryImport(client, userId, importRunId, stream)
        if (!result.completed) {
          // Keep pages small and spaced out; other streams share the same
          // authenticated Substack session and are interleaved by this queue.
          await withTenant(client, userId, async () => {
            await client.query(
              `insert into jobs (type, payload, status, run_at)
               select 'import:history', $1, 'pending', now() + interval '2 seconds'
               where exists (
                 select 1 from import_runs
                 where id = $2 and status = 'running'
               )`,
              [JSON.stringify(payload), importRunId]
            )
          })
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
      } else if (job.type === "reprocess:interaction-evidence") {
        const result = await processStoredInteractionEvidence(
          client,
          userId,
          connectionId,
          {
            activityDone: payload.activityDone === true,
            afterReceivedAt: payload.afterReceivedAt ?? null,
            afterBatchId: payload.afterBatchId ?? null,
          },
        )
        if (!result.completed && result.cursor) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('reprocess:interaction-evidence', $1, 'pending', now() + interval '1 second')`,
            [JSON.stringify({ ...payload, ...result.cursor })],
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
      console.error(`[Circles Worker] Job ${job.id} (${job.type}) failed:`, jobError?.message)
      const errorMessage = String(jobError?.message || "Unknown worker error")
      const isUnauthorized = jobError?.status === 401 ||
        jobError?.statusCode === 401 ||
        /\b401\b/.test(errorMessage)
      const sessionExpired = isUnauthorized || /\bexpired\b/i.test(errorMessage)
      const failureMessage = sessionExpired ? "Substack session expired" : errorMessage

      // The request transaction has already rolled back at this point, so
      // persist expiry in a fresh tenant transaction instead of losing it.
      if (sessionExpired && userId && connectionId) {
        try {
          await withTenant(client, userId, async () => {
            await client.query(
              "update substack_connections set status = 'expired', updated_at = now() where id = $1",
              [connectionId],
            )
            await client.query(
              "update sync_state set status = 'error', error = 'Substack session expired', updated_at = now() where connection_id = $1",
              [connectionId],
            )
          })
        } catch (expiryError: any) {
          console.error(
            `[Circles Worker] Could not persist expired status for connection ${connectionId}:`,
            expiryError?.message,
          )
        }
      }
      const isRateLimited = jobError?.status === 429 ||
        jobError?.statusCode === 429 ||
        errorMessage.includes("429")
      const isDead = (
        !isRateLimited && job.attempts + 1 >= job.max_attempts
      ) || sessionExpired

      if (isDead) {
        await client.query(
          "update jobs set status = 'dead', last_error = $2, updated_at = now() where id = $1",
          [job.id, failureMessage]
        )
        if (importRunId && stream && userId) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update import_run_streams
               set status = 'failed', finish_reason = $4, error = $3, updated_at = now()
               where import_run_id = $1 and stream = $2 and status = 'running'`,
              [
                importRunId,
                stream ?? "activity",
                failureMessage,
                sessionExpired ? "session_expired" : "retry_limit",
              ],
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
          [job.id, retryDelaySeconds, failureMessage]
        )
        if (importRunId && stream && userId) {
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
                  : failureMessage,
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
                  : failureMessage,
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
