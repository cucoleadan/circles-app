import type { PoolClient } from "pg"
import {
  applyFollowerSnapshot,
  applyFollowingSnapshot,
  createSubstackClient,
  parseFollowerRunStartedAt,
  parseFollowerList,
  parseSubscriberStatsPage,
  reconcileSubscriberSnapshot,
  shouldAbortFollowerSweep,
  upsertSubscribersBatch,
  openSessionToken,
} from "@workspace/core"
import { withTenant, substackResponseError } from "./tenant.js"
import { finishImportIfReady } from "./imports.js"

export const SUBSCRIBER_PAGE_SIZE = 100
export const SUBSCRIBER_PAGE_OVERLAP = 10
export const INCREMENTAL_SUBSCRIBER_MAX_PAGES = 10
/** Re-read subscribers this far behind the newest stored subscription. */
const INCREMENTAL_SUBSCRIBER_OVERLAP_MS = 24 * 60 * 60 * 1000

export type SubscriberSortDirection = "asc" | "desc"

export interface IncrementalSubscriberState {
  since?: string | null
  direction?: SubscriberSortDirection | null
  pages?: number
}

/**
 * Plan the next page of an incremental subscriber read. Substack's sort
 * direction for subscription_created_at is detected from the page itself, so
 * the walk reads newest-first either way and stops at the checkpoint.
 */
export function nextIncrementalSubscriberOffset(input: {
  offset: number
  total: number
  received: number
  dates: Array<string | null | undefined>
  direction?: SubscriberSortDirection | null
  since: Date
  pages: number
  limit?: number
  maxPages?: number
}): { direction: SubscriberSortDirection; nextOffset: number | null } {
  const limit = input.limit ?? SUBSCRIBER_PAGE_SIZE
  const maxPages = input.maxPages ?? INCREMENTAL_SUBSCRIBER_MAX_PAGES
  const times = input.dates
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value))
  const probing = !input.direction
  const direction: SubscriberSortDirection = input.direction
    ?? (times.length >= 2 && times[0]! < times[times.length - 1]! ? "asc" : "desc")

  if (input.received === 0 || input.pages >= maxPages) return { direction, nextOffset: null }
  const reachedCheckpoint = times.some((value) => value < input.since.getTime())

  if (direction === "desc") {
    const next = input.offset + input.received
    return { direction, nextOffset: reachedCheckpoint || next >= input.total ? null : next }
  }
  // Ascending: the newest subscribers are at the end of the list.
  if (probing) {
    return { direction, nextOffset: input.received >= input.total ? null : Math.max(0, input.total - limit) }
  }
  if (reachedCheckpoint || input.offset === 0) return { direction, nextOffset: null }
  return { direction, nextOffset: Math.max(0, input.offset - limit) }
}

export async function processSubscriberSyncPage(
  client: PoolClient,
  userId: string,
  connectionId: string,
  offset = 0,
  runStartedAtValue?: unknown,
  incremental?: IncrementalSubscriberState | null,
) {
  const runStartedAt = parseFollowerRunStartedAt(runStartedAtValue)
  const conn = await withTenant(client, userId, async () => {
    const connection = await client.query(
      `select key_id, iv, ciphertext, publication_url, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    return connection.rows[0]
  })
  if (!conn || conn.status !== "active") return { completed: true, skipped: true }
  const publicationUrl = String(conn.publication_url ?? "").replace(/\/$/, "")
  if (!publicationUrl) throw new Error("Publication URL is not set on the active connection")

  let since: Date | null = null
  if (incremental) {
    const stored = incremental.since ? new Date(incremental.since) : null
    if (stored && !Number.isNaN(stored.getTime())) {
      since = stored
    } else {
      const newest = await withTenant(client, userId, async () => {
        const result = await client.query(
          `select max(subscribed_at) as newest from people
           where user_id = $1 and archived_at is null and is_subscriber = true`,
          [userId],
        )
        return result.rows[0]?.newest
      })
      // Without a stored subscriber there is no checkpoint; fall back to a full sweep.
      if (newest) since = new Date(new Date(newest).getTime() - INCREMENTAL_SUBSCRIBER_OVERLAP_MS)
    }
  }

  const response = await fetch(`${publicationUrl}/api/v1/subscriber-stats`, {
    method: "POST",
    headers: {
      cookie: `substack.sid=${openSessionToken(conn)}`,
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      limit: SUBSCRIBER_PAGE_SIZE,
      offset,
      filters: { order_by: "subscription_created_at" },
    }),
  })
  if (!response.ok) throw substackResponseError("Substack subscriber API failed", response.status)

  const page = parseSubscriberStatsPage(await response.json())

  if (since) {
    const pages = Number(incremental?.pages ?? 0) + 1
    const plan = nextIncrementalSubscriberOffset({
      offset,
      total: page.total,
      received: page.received,
      dates: page.subscribers.map((sub) => sub.subscription_created_at),
      direction: incremental?.direction,
      since,
      pages,
    })
    return withTenant(client, userId, async () => {
      const batch = await upsertSubscribersBatch(
        client,
        userId,
        page.subscribers,
        new Date().toISOString(),
      )
      return {
        completed: plan.nextOffset === null,
        skipped: false,
        mode: "incremental" as const,
        nextOffset: plan.nextOffset ?? offset + page.received,
        direction: plan.direction,
        since: since!.toISOString(),
        pages,
        total: page.total,
        processed: page.subscribers.length,
        matched: batch.matched,
        created: batch.created,
        invalid: page.skipped + batch.skipped,
        // Incremental reads never see the whole list, so they never clear memberships.
        deactivated: 0,
        runStartedAt: runStartedAt.toISOString(),
      }
    })
  }

  return withTenant(client, userId, async () => {
    const batch = await upsertSubscribersBatch(
      client,
      userId,
      page.subscribers,
      new Date().toISOString(),
    )
    const completed = page.received === 0 || offset + page.received >= page.total
    // Overlap pages so a subscriber who leaves mid-sweep cannot shift someone
    // else past a page boundary and get them wrongly marked unsubscribed.
    const nextOffset = completed
      ? offset + page.received
      : offset + Math.max(1, page.received - SUBSCRIBER_PAGE_OVERLAP)
    const deactivated = completed
      ? await reconcileSubscriberSnapshot(client, userId, runStartedAt.toISOString())
      : 0
    return {
      completed,
      skipped: false,
      mode: "full" as const,
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
  const conn = await withTenant(client, userId, async () => {
    const connection = await client.query(
      `select key_id, iv, ciphertext, profile_id, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    return connection.rows[0]
  })
  if (!conn || conn.status !== "active") {
    return { completed: true, skipped: true, checked: 0, updated: 0, failed: 0, remaining: 0 }
  }
  if (!conn.profile_id) throw new Error("Substack profile ID is missing from the active connection")

  const response = await fetch(
    `https://substack.com/api/v1/user/${encodeURIComponent(conn.profile_id)}/subscriber-lists?lists=followers`,
    { headers: { cookie: `substack.sid=${openSessionToken(conn)}`, accept: "application/json" } },
  )
  if (!response.ok) throw substackResponseError("Substack follower-list API failed", response.status)
  const page = parseFollowerList(await response.json())

  return withTenant(client, userId, async () => {
    const result = await applyFollowerSnapshot(client, userId, page.followers)
    return {
      completed: true,
      skipped: false,
      checked: result.processed,
      updated: result.followers,
      created: result.created,
      matched: result.matched,
      failed: page.skipped,
      remaining: 0,
      runStartedAt: runStartedAt.toISOString(),
    }
  })
}

export async function processFollowingSync(
  client: PoolClient,
  userId: string,
  connectionId: string,
) {
  const conn = await withTenant(client, userId, async () => {
    const connection = await client.query(
      `select key_id, iv, ciphertext, publication_url, profile_id, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    return connection.rows[0]
  })
  if (!conn || conn.status !== "active") {
    return { completed: true, skipped: true, checked: 0, updated: 0, failed: 0 }
  }

  const sdk = createSubstackClient({
    sessionToken: openSessionToken(conn),
    publicationUrl: conn.publication_url,
  })
  const page = parseFollowerList(
    await sdk.getFollowing(conn.profile_id ? { profileId: conn.profile_id } : undefined),
  )
  return withTenant(client, userId, async () => {
    const result = await applyFollowingSnapshot(client, userId, page.followers)
    return {
      completed: true,
      skipped: false,
      checked: result.checked,
      updated: result.following,
      subscribed: result.subscribed,
      created: result.created,
      failed: page.skipped,
    }
  })
}

export async function recordAudienceImportProgress(
  client: PoolClient,
  userId: string,
  importRunId: string,
  stream: "subscribers" | "followers" | "following",
  result: any,
) {
  return withTenant(client, userId, async () => {
    const checked = Number(stream === "subscribers" ? result.processed : result.checked) || 0
    const newPeople = Number(stream === "subscribers" || stream === "followers" ? result.created : 0) || 0
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

export function profileHandle(profile: any) {
  const value = profile?.handle ?? profile?.profile?.handle
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/^@/, "")
    : null
}

export async function processMissingHandleBackfill(
  client: PoolClient,
  userId: string,
  connectionId: string,
  afterId?: string | null,
) {
  const state = await withTenant(client, userId, async () => {
    const connection = await client.query(
      `select key_id, iv, ciphertext, publication_url, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const person = await client.query(
      `select id, substack_profile_id
       from people
       where user_id = $1 and archived_at is null and normalized_handle is null
         and substack_profile_id is not null
         and ($2::text is null or id > $2::text)
       order by id limit 1`,
      [userId, afterId ?? null],
    )
    return { connection: connection.rows[0], person: person.rows[0] }
  })
  if (!state.connection || state.connection.status !== "active") {
    return { completed: true, skipped: true, checked: 0, recovered: 0, failed: 0, afterId }
  }
  if (!state.person) {
    const unresolvable = await withTenant(client, userId, async () => {
      const result = await client.query(
        `select count(*)::int as count from people
         where user_id = $1 and archived_at is null and normalized_handle is null
           and substack_profile_id is null`,
        [userId],
      )
      return result.rows[0]?.count ?? 0
    })
    return { completed: true, skipped: false, checked: 0, recovered: 0, failed: 0, unresolvable, afterId }
  }

  let handle: string | null = null
  try {
    const sdk = createSubstackClient({
      sessionToken: openSessionToken(state.connection),
      publicationUrl: state.connection.publication_url,
    })
    handle = profileHandle(await sdk.getProfileById(state.person.substack_profile_id))
  } catch (error) {
    if (shouldAbortFollowerSweep(error)) throw error
    // Continue the repair run; this profile can be retried in a later run.
  }

  const recovered = await withTenant(client, userId, async () => {
    if (!handle) return 0
    const normalized = handle.toLowerCase()
    const result = await client.query(
      `update people p set handle = $3, normalized_handle = $4, updated_at = now()
       where p.id = $1 and p.user_id = $2 and p.normalized_handle is null
         and not exists (
           select 1 from people other
           where other.user_id = $2 and other.archived_at is null
             and other.normalized_handle = $4 and other.id <> p.id
         )`,
      [state.person.id, userId, handle, normalized],
    )
    return result.rowCount ?? 0
  })
  return {
    completed: false,
    skipped: false,
    checked: 1,
    recovered,
    failed: recovered ? 0 : 1,
    afterId: state.person.id as string,
  }
}

export async function recordMissingHandleProgress(
  client: PoolClient,
  userId: string,
  importRunId: string,
  result: any,
) {
  return withTenant(client, userId, async () => {
    const warning = result.unresolvable
      ? `${result.unresolvable} contacts have no stable Substack profile ID and cannot be resolved automatically`
      : result.failed ? "A profile ID did not return a usable unique handle" : null
    const updated = await client.query(
      `update import_run_streams
       set pages = pages + 1, items = items + $3, new_people = new_people + $4,
           cursor = $5,
           status = case when $6 then 'failed' when $7 then 'complete' else 'running' end,
           completeness = case when $7 and $8::text is null then 'complete' else 'partial' end,
           finish_reason = case when $6 then 'connection_inactive'
                                when $7 then 'stable_ids_exhausted' else finish_reason end,
           error = case when $6 then 'Substack connection is inactive or expired' else $8 end,
           updated_at = now()
       where import_run_id = $1 and stream = $2 and status = 'running'
       returning status`,
      [
        importRunId,
        "missing_handles",
        Number(result.checked ?? 0),
        Number(result.recovered ?? 0),
        JSON.stringify({ afterId: result.afterId ?? null }),
        result.skipped === true,
        result.completed === true,
        warning,
      ],
    )
    await finishImportIfReady(client, importRunId)
    return updated.rows[0]?.status === "running"
  })
}
