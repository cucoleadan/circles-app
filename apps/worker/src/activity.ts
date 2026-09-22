import { createHash, randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  normalizeActivityPage,
  type ActivityItemInput,
} from "@workspace/core"
import {
  syncOwnedNotesPage,
  syncOwnedPostsPage,
  syncRecentOutboundActions,
  type OutboundStage,
} from "./history.js"
import { withTenant } from "./tenant.js"

export type HistoryStream = "activity" | "owned_notes" | "owned_posts" | "outbound_actions"
export type ScheduledHistoryStream = Exclude<HistoryStream, "activity">

export async function preserveActivityEvidence(
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

    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const allItems: ActivityItemInput[] = normalizeActivityPage(activityPage)
    await preserveActivityEvidence(client, userId, connectionId, "sdk", activityPage)

    // Only ingest items occurring within the past 3 hours for periodic sync
    const items = allItems.filter((item) => {
      const ts = item.created_at || item.createdAt || item.updated_at
      if (!ts) return false
      const d = new Date(ts)
      return !Number.isNaN(d.getTime()) && d >= threeHoursAgo
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
           next_run_at = now() + interval '3 hours',
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
    const recentCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000)
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
