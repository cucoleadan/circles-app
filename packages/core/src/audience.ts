import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"

type UnknownRecord = Record<string, unknown>

export interface SubscriberItem {
  id: number | string
  name?: string | null
  photo_url?: string | null
  handle?: string | null
  subscription_type?: string | null
  subscription_created_at?: string | null
}

export interface SubscriberStatsPage {
  subscribers: SubscriberItem[]
  total: number
  received: number
  skipped: number
}

export interface FollowerListItem {
  id: string
  handle: string | null
  name?: string | null
  photo_url?: string | null
  isSubscribed: boolean
}

/**
 * Normalize `/api/v1/feed/following`: the IDs of every user the session follows.
 * It replaces `subscriber-lists?lists=following`, which Cloudflare now challenges
 * for non-browser clients. It carries no names, handles or subscription state.
 */
export function parseFollowingIds(payload: unknown): { followers: FollowerListItem[]; skipped: number } {
  if (!Array.isArray(payload)) throw new Error("Substack returned an invalid following response")
  const ids = new Set<string>()
  let skipped = 0
  for (const value of payload) {
    const id = typeof value === "number" || typeof value === "string" ? String(value).trim() : ""
    if (/^\d+$/.test(id)) ids.add(id)
    else skipped++
  }
  return { followers: [...ids].map((id) => ({ id, handle: null, isSubscribed: false })), skipped }
}

/** Apply the owner's complete following list without conflating it with inbound followers. */
export async function applyFollowingSnapshot(
  client: PoolClient,
  userId: string,
  following: FollowerListItem[],
  // An ID-only snapshot says nothing about paid/free subscriptions; keep what is stored.
  subscriptionsKnown = true,
) {
  const profileIds = following.map((person) => person.id)
  const handles = following
    .map((person) => person.handle ? normalizeHandle(person.handle) : null)
    .filter((handle): handle is string => Boolean(handle))
  const subscribedProfileIds = following.filter((person) => person.isSubscribed).map((person) => person.id)
  const subscribedHandles = following
    .filter((person) => person.isSubscribed && person.handle)
    .map((person) => normalizeHandle(person.handle!))
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`audience:${userId}`])

  let created = 0
  for (const person of following) {
    const profileId = person.id.trim()
    if (!profileId) continue
    const handle = person.handle?.trim().replace(/^@/, "") || null
    const normalized = handle ? normalizeHandle(handle) : null
    const existing = await client.query(
      `select id, substack_profile_id from people
       where user_id = $1 and archived_at is null
         and (substack_profile_id = $2
           or ($3::text is not null and normalized_handle = $3
             and substack_profile_id is null))
       order by case when substack_profile_id = $2 then 0 else 1 end
       limit 1`,
      [userId, profileId, normalized],
    )
    if (existing.rows[0]) {
      await client.query(
        `update people set substack_profile_id = coalesce(substack_profile_id, $2),
           avatar_url = coalesce(avatar_url, $3), updated_at = now()
         where id = $1`,
        [existing.rows[0].id, profileId, person.photo_url ?? null],
      )
      continue
    }

    const conflictingHandle = normalized ? await client.query(
      `select 1 from people where user_id = $1 and archived_at is null
       and normalized_handle = $2 and substack_profile_id is distinct from $3
       limit 1`,
      [userId, normalized, profileId],
    ) : null
    const safeHandle = conflictingHandle?.rows[0] ? null : handle
    const safeNormalized = safeHandle ? normalized : null
    const personId = randomUUID()
    const inserted = await client.query(
      `insert into people
          (id, user_id, name, handle, normalized_handle, profile_url,
           substack_profile_id, avatar_url, is_following, is_subscribed_to,
           following_checked_at, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, now(), 'following')
       on conflict do nothing`,
      [
        personId,
        userId,
        person.name?.trim() || safeHandle || `Following ${profileId}`,
        safeHandle,
        safeNormalized,
        safeNormalized ? `https://substack.com/@${encodeURIComponent(safeNormalized)}` : null,
        profileId,
        person.photo_url ?? null,
        person.isSubscribed,
      ],
    )
    if (!inserted.rowCount) continue
    await client.query(
      `insert into relationship_stats (person_id, user_id, drift_status, updated_at)
       values ($1, $2, 'new', now())
       on conflict (person_id) do nothing`,
      [personId, userId],
    )
    created++
  }

  const result = await client.query(
    `with updated as (
       update people p
       set is_following = (
             (p.substack_profile_id is not null and p.substack_profile_id = any($2::text[]))
             or (p.substack_profile_id is null and p.normalized_handle is not null and p.normalized_handle = any($3::text[]))
           ),
           is_subscribed_to = case when $6 then (
             (p.substack_profile_id is not null and p.substack_profile_id = any($4::text[]))
             or (p.substack_profile_id is null and p.normalized_handle is not null and p.normalized_handle = any($5::text[]))
           ) else coalesce(p.is_subscribed_to, false) end,
           following_checked_at = now(),
           updated_at = now()
       where p.user_id = $1 and p.archived_at is null
         and (p.normalized_handle is not null or p.substack_profile_id is not null)
       returning is_following, is_subscribed_to
     )
     select count(*)::int as checked,
            count(*) filter (where is_following)::int as following,
            count(*) filter (where is_subscribed_to)::int as subscribed
     from updated`,
    [userId, profileIds, handles, subscribedProfileIds, subscribedHandles, subscriptionsKnown],
  )
  return {
    checked: result.rows[0]?.checked ?? 0,
    following: result.rows[0]?.following ?? 0,
    subscribed: result.rows[0]?.subscribed ?? 0,
    created,
  }
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null

const optionalBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : false

const normalizeHandle = (handle: string) =>
  handle.trim().replace(/^@/, "").toLowerCase()

function subscriptionTier(record: UnknownRecord) {
  const explicit = optionalString(record.subscription_type)
  if (explicit) return explicit
  if (optionalBoolean(record.is_founding)) return "founding"
  if (optionalBoolean(record.is_free_trial)) return "trial"
  if (optionalBoolean(record.is_gift)) return "gift"
  if (optionalBoolean(record.is_comp)) return "comp"
  return "free"
}

/** Normalize only non-sensitive subscriber identity and membership fields. */
export function parseSubscriberStatsPage(payload: unknown): SubscriberStatsPage {
  if (!isRecord(payload)) throw new Error("Substack returned an invalid subscriber response")

  const rawSubscribers = Array.isArray(payload.subscribers)
    ? payload.subscribers
    : Array.isArray(payload.users)
      ? payload.users
      : null
  if (!rawSubscribers) {
    throw new Error("Substack subscriber response did not contain a subscriber list")
  }

  const chartCounts = isRecord(payload.chartCounts) ? payload.chartCounts : null
  const rawTotal = payload.count ?? payload.total ?? chartCounts?.totalEmail
  const parsedTotal = typeof rawTotal === "number" ? rawTotal : Number(rawTotal)
  const total = Number.isFinite(parsedTotal) && parsedTotal >= 0
    ? Math.trunc(parsedTotal)
    : rawSubscribers.length

  const subscribers: SubscriberItem[] = []
  let skipped = 0
  for (const value of rawSubscribers) {
    if (!isRecord(value)) {
      skipped++
      continue
    }

    const rawId = value.user_id ?? value.id
    const id = typeof rawId === "number" || typeof rawId === "string"
      ? String(rawId).trim()
      : ""
    if (!id) {
      skipped++
      continue
    }

    subscribers.push({
      id,
      name: optionalString(value.user_name ?? value.name),
      photo_url: optionalString(value.user_photo_url ?? value.photo_url),
      handle: optionalString(value.user_handle ?? value.handle),
      subscription_type: subscriptionTier(value),
      subscription_created_at: optionalString(value.subscription_created_at),
    })
  }

  return { subscribers, total, received: rawSubscribers.length, skipped }
}

export function parseFollowerRunStartedAt(value: unknown, now = new Date()) {
  if (typeof value !== "string") return now
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) return now
  return parsed
}

export function shouldAbortFollowerSweep(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  const status = candidate.status ?? candidate.statusCode
  if (status === 401 || status === 429) return true
  return /\b(401|429)\b/.test(String(candidate.message ?? ""))
}

export async function upsertSubscribersBatch(
  client: PoolClient,
  userId: string,
  subscribers: SubscriberItem[],
  observedAt?: string,
): Promise<{ matched: number; created: number; skipped: number }> {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`audience:${userId}`])
  let matched = 0
  let created = 0
  let skipped = 0

  const rows: Array<{
    substackProfileId: string
    handle: string | null
    normalized: string | null
    name: string
    avatarUrl: string | null
    subscribedAt: string | null
    tier: string
  }> = []
  const seenProfileIds = new Set<string>()
  for (const sub of subscribers) {
    const substackProfileId = sub.id ? String(sub.id).trim() : null
    if (!substackProfileId) {
      skipped++
      continue
    }
    // Overlapping sweep pages can repeat a subscriber; count it once per batch.
    if (seenProfileIds.has(substackProfileId)) continue
    seenProfileIds.add(substackProfileId)
    const rawHandle = sub.handle?.trim()
    const handle = rawHandle ? rawHandle.replace(/^@/, "") : null
    const parsedSubscribedAt = sub.subscription_created_at
      ? new Date(sub.subscription_created_at)
      : null
    rows.push({
      substackProfileId,
      handle,
      normalized: handle ? normalizeHandle(handle) : null,
      name: sub.name?.trim() || handle || `Subscriber ${substackProfileId}`,
      avatarUrl: sub.photo_url || null,
      subscribedAt: parsedSubscribedAt && !Number.isNaN(parsedSubscribedAt.getTime())
        ? parsedSubscribedAt.toISOString()
        : null,
      tier: sub.subscription_type || "free",
    })
  }
  if (rows.length === 0) return { matched, created, skipped }

  // Resolve the whole page in one lookup. Stable profile ID wins; a handle only
  // matches a contact that has no conflicting profile ID.
  const existing = await client.query(
    `select id, substack_profile_id, normalized_handle from people
     where user_id = $1 and archived_at is null
       and (substack_profile_id = any($2::text[]) or normalized_handle = any($3::text[]))`,
    [
      userId,
      rows.map((row) => row.substackProfileId),
      rows.flatMap((row) => (row.normalized ? [row.normalized] : [])),
    ],
  )
  const byProfileId = new Map<string, string>()
  const byHandle = new Map<string, { id: string; profileId: string | null }>()
  for (const person of existing.rows) {
    if (person.substack_profile_id) byProfileId.set(String(person.substack_profile_id), person.id)
    if (person.normalized_handle) {
      byHandle.set(person.normalized_handle, {
        id: person.id,
        profileId: person.substack_profile_id ? String(person.substack_profile_id) : null,
      })
    }
  }

  const updates: Array<(typeof rows)[number] & { personId: string }> = []
  const updatedPeople = new Set<string>()
  const unmatched: typeof rows = []
  for (const row of rows) {
    const handleMatch = row.normalized ? byHandle.get(row.normalized) : undefined
    const personId = byProfileId.get(row.substackProfileId) ??
      (handleMatch && (!handleMatch.profileId || handleMatch.profileId === row.substackProfileId)
        ? handleMatch.id
        : undefined)
    if (!personId) {
      unmatched.push(row)
      continue
    }
    matched++
    if (updatedPeople.has(personId)) continue
    updatedPeople.add(personId)
    updates.push({ ...row, personId })
  }

  if (updates.length > 0) {
    await client.query(
      `update people p
       set is_subscriber = true,
           subscribed_at = coalesce(p.subscribed_at, v.subscribed_at),
           subscription_tier = coalesce(v.tier, p.subscription_tier),
           substack_profile_id = coalesce(p.substack_profile_id, v.profile_id),
           avatar_url = coalesce(p.avatar_url, v.avatar_url),
           subscriber_checked_at = coalesce($6::timestamptz, p.subscriber_checked_at),
           updated_at = now()
       from unnest($1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::text[])
         as v(id, subscribed_at, tier, profile_id, avatar_url)
       where p.id = v.id and p.user_id = $7`,
      [
        updates.map((row) => row.personId),
        updates.map((row) => row.subscribedAt),
        updates.map((row) => row.tier),
        updates.map((row) => row.substackProfileId),
        updates.map((row) => row.avatarUrl),
        observedAt ?? null,
        userId,
      ],
    )
  }

  for (const row of unmatched) {
    const { substackProfileId, handle, normalized, name, avatarUrl, subscribedAt, tier } = row
    const newId = randomUUID()
    const conflictingHandle = normalized ? await client.query(
      `select 1 from people where user_id = $1 and archived_at is null
       and normalized_handle = $2 and substack_profile_id is distinct from $3
       limit 1`,
      [userId, normalized, substackProfileId],
    ) : null
    const safeHandle = conflictingHandle?.rows[0] ? null : handle
    const safeNormalized = safeHandle ? normalized : null
    const inserted = await client.query(
      `insert into people
          (id, user_id, name, handle, normalized_handle, profile_url,
           substack_profile_id, avatar_url, is_subscriber, subscribed_at,
           subscription_tier, subscriber_checked_at, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::timestamptz, $10,
               $11::timestamptz, 'subscribers')
       on conflict do nothing`,
      [
        newId, userId, name, safeHandle, safeNormalized,
        safeNormalized ? `https://substack.com/@${encodeURIComponent(safeNormalized)}` : null,
        substackProfileId, avatarUrl, subscribedAt, tier, observedAt ?? null,
      ]
    )
    if (!inserted.rowCount) {
      skipped++
      continue
    }
    await client.query(
      `insert into relationship_stats (person_id, user_id, drift_status, updated_at)
       values ($1, $2, 'new', now())
       on conflict (person_id) do nothing`,
      [newId, userId]
    )
    created++
  }

  return { matched, created, skipped }
}

/** Clear current-membership flags only after a complete authoritative sweep. */
export async function reconcileSubscriberSnapshot(
  client: PoolClient,
  userId: string,
  runStartedAt: string,
) {
  const result = await client.query(
    `update people
     set is_subscriber = false,
         subscription_tier = null,
         subscriber_checked_at = now(),
         updated_at = now()
     where user_id = $1 and archived_at is null and is_subscriber = true
       and (subscriber_checked_at is null or subscriber_checked_at < $2::timestamptz)`,
    [userId, runStartedAt],
  )
  return result.rowCount ?? 0
}
