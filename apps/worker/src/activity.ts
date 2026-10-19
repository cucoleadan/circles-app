import { createHash, randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import type { PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  normalizeActivityPage,
  openSessionToken,
  resealSessionToken,
  type ActivityItemInput,
} from "@workspace/core"
import {
  syncOwnedNotesPage,
  syncOwnedPostsPage,
  syncRecentOutboundActions,
  type OutboundStage,
} from "./history.js"
import { SESSION_EXPIRED_MESSAGE, substackResponseError, withTenant } from "./tenant.js"

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

/** Re-read this far behind the last successful activity sync. */
const ACTIVITY_OVERLAP_MS = 30 * 60 * 1000
/** Upper bound on activity pages read by one scheduled sync. */
export const MAX_ACTIVITY_SYNC_PAGES = 5
const ACTIVITY_PAGE_PAUSE_MS = 2_000

function activityItemTime(item: ActivityItemInput): number | null {
  // Grouped notifications keep their first created_at while new senders bump
  // updated_at, so the newest of the two decides whether an item is current.
  const times = [item.updated_at, item.created_at, item.createdAt]
    .map((value) => (value === undefined || value === null ? Number.NaN : new Date(value).getTime()))
    .filter((value) => Number.isFinite(value))
  return times.length ? Math.max(...times) : null
}

/**
 * Whether another activity page is needed to reach the checkpoint. Without a
 * checkpoint (first sync) only the newest page is read; backfill owns history.
 */
export function needsAnotherActivityPage(
  items: ActivityItemInput[],
  checkpoint: Date | null,
  nextCursor: unknown,
  pagesRead: number,
) {
  if (!checkpoint || !nextCursor || items.length === 0 || pagesRead >= MAX_ACTIVITY_SYNC_PAGES) return false
  const times = items.map(activityItemTime).filter((value): value is number => value !== null)
  if (times.length === 0) return false
  return Math.min(...times) >= checkpoint.getTime()
}

export async function processActivitySync(
  client: PoolClient,
  userId: string,
  connectionId: string
) {
  // 1. Read the connection and the last successful sync in a short transaction.
  const state = await withTenant(client, userId, async () => {
    const connRes = await client.query(
      `select id, key_id, iv, ciphertext, publication_url, profile_id, profile_handle, status
       from substack_connections
       where id = $1 and user_id = $2`,
      [connectionId, userId]
    )
    // Encrypt a session stored before SESSION_TOKEN_KEY was configured, without a reconnect.
    const resealed = connRes.rows[0] && resealSessionToken(connRes.rows[0])
    if (resealed) {
      await client.query(
        `update substack_connections
         set key_id = $2, wrapped_key = $3, iv = $4, ciphertext = $5, updated_at = now()
         where id = $1`,
        [connectionId, resealed.keyId, resealed.wrappedKey, resealed.iv, resealed.ciphertext],
      )
      Object.assign(connRes.rows[0], { key_id: resealed.keyId, iv: resealed.iv, ciphertext: resealed.ciphertext })
    }
    const checkpoint = await client.query(
      `select last_synced_at from sync_stream_state
       where connection_id = $1 and stream = 'activity'`,
      [connectionId],
    )
    return { conn: connRes.rows[0], lastSyncedAt: checkpoint.rows[0]?.last_synced_at ?? null }
  })
  const conn = state.conn
  if (!conn || conn.status !== "active") {
    console.log(`[Circles Worker] Connection ${connectionId} is no longer active; skipping sync.`)
    return { skipped: true }
  }

  const ownerHandle = conn.profile_handle
  const ownerId = conn.profile_id
  const checkpoint = state.lastSyncedAt
    ? new Date(new Date(state.lastSyncedAt).getTime() - ACTIVITY_OVERLAP_MS)
    : null

  // 2. Read newest-first pages back to the checkpoint, outside any transaction.
  // Items are not filtered by time: ingestion is idempotent on stable IDs, and
  // grouped notifications gain new senders long after they were created.
  const sdk = createSubstackClient({
    sessionToken: openSessionToken(conn),
    publicationUrl: conn.publication_url,
  })
  const pages: any[] = []
  let cursor: string | null = null
  do {
    if (pages.length > 0) await sleep(ACTIVITY_PAGE_PAUSE_MS)
    let activityPage: any
    try {
      activityPage = await sdk.getActivityPage(cursor ? { after: cursor } : undefined)
    } catch (err: any) {
      if (err?.statusCode === 401 || err?.status === 401 || /\b401\b/.test(String(err?.message ?? ""))) {
        console.warn(`[Circles Worker] Session expired for connection ${connectionId}.`)
        // The job runner persists the expiry in its own transaction.
        throw substackResponseError(SESSION_EXPIRED_MESSAGE, 401)
      }
      throw err
    }
    pages.push(activityPage)
    cursor = activityPage?.nextAfter ?? activityPage?.nextCursor ?? null
  } while (needsAnotherActivityPage(normalizeActivityPage(pages.at(-1)), checkpoint, cursor, pages.length))

  // 3. Store evidence and ingest in one transaction.
  return withTenant(client, userId, async () => {
    for (const page of pages) {
      await preserveActivityEvidence(client, userId, connectionId, "sdk", page)
    }
    const items: ActivityItemInput[] = pages.flatMap((page) => normalizeActivityPage(page))
    const stats = await ingestActivityBatch(client, {
      userId,
      connectionId,
      ownerHandle,
      ownerId,
      items,
      source: "sdk",
    })

    const firstPage = pages[0]
    const nextCursor = firstPage?.nextAfter ?? firstPage?.nextCursor ?? null

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
           next_run_at = now() + interval '10 minutes',
           status = 'idle',
           error = null,
           updated_at = now()
       where connection_id = $1`,
      [connectionId, nextCursor]
    )

    console.log(
      `[Circles Worker] Synced connection ${connectionId}: ${stats.processedItems} items processed from ${pages.length} page(s), ` +
        `${stats.newInteractions} new interactions, ${stats.newPeople} new contacts.`
    )

    return { skipped: false, stats }
  })
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Newest owned Notes whose reply trees each scheduled sync refreshes. */
const SCHEDULED_NOTE_REFRESH_LIMIT = 6
const SCHEDULED_NOTE_REFRESH_DAYS = 7
/** Newest owned posts whose comment trees each scheduled sync refreshes. */
const SCHEDULED_POST_REFRESH_LIMIT = 3
const SCHEDULED_POST_REFRESH_DAYS = 14

export async function processScheduledHistorySync(
  client: PoolClient,
  userId: string,
  connectionId: string,
  stream: ScheduledHistoryStream,
  outboundStage?: OutboundStage,
) {
  const conn = await withTenant(client, userId, async () => {
    const connection = await client.query(
      `select key_id, iv, ciphertext, publication_url, profile_handle, profile_id, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active") return null

    await client.query(
      `insert into sync_stream_state (connection_id, user_id, stream, status, completeness, updated_at)
       values ($1, $2, $3, 'running', 'partial', now())
       on conflict (connection_id, stream) do update
         set status = 'running', error = null, updated_at = now()`,
      [connectionId, userId, stream],
    )
    return conn
  })
  if (!conn) return { skipped: true }

  const sdk = createSubstackClient({
    sessionToken: openSessionToken(conn),
    publicationUrl: conn.publication_url,
  })
  const context = {
    userId,
    connectionId,
    ownerHandle: conn.profile_handle,
    ownerId: conn.profile_id,
    source: "sdk" as const,
  }
  // Fetch outside any transaction; each item's writes get a short one.
  const db = <T>(fn: (client: PoolClient) => Promise<T>) => withTenant(client, userId, () => fn(client))
  // Replies keep arriving on older content, so refresh the reply trees of
  // recently published Notes/posts rather than only the newest one. Outbound
  // pages are re-read over a day; stable IDs make the overlap idempotent.
  const now = Date.now()
  const result = stream === "owned_notes"
    ? await syncOwnedNotesPage(
        db, sdk, context, null,
        SCHEDULED_NOTE_REFRESH_LIMIT, new Date(now - SCHEDULED_NOTE_REFRESH_DAYS * DAY_MS),
      )
    : stream === "owned_posts"
      ? await syncOwnedPostsPage(
          db, sdk, context, null,
          SCHEDULED_POST_REFRESH_LIMIT, new Date(now - SCHEDULED_POST_REFRESH_DAYS * DAY_MS),
        )
      : await syncRecentOutboundActions(
          db, sdk, context, outboundStage === "replies" ? 40 : 20, outboundStage, new Date(now - DAY_MS),
        )

  await db((tx) => tx.query(
    `update sync_stream_state
     set status = 'idle', last_synced_at = now(), completeness = 'partial',
         finish_reason = 'recent_window', error = null, updated_at = now()
     where connection_id = $1 and stream = $2`,
    [connectionId, stream],
  ))
  return { skipped: false, stats: result }
}
