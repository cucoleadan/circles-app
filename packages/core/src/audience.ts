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

/** Normalize the authenticated owner's complete follower list. */
export function parseFollowerList(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.subscriberLists)) {
    throw new Error("Substack returned an invalid follower-list response")
  }

  const followers = new Map<string, FollowerListItem>()
  let skipped = 0
  for (const list of payload.subscriberLists) {
    if (!isRecord(list) || !Array.isArray(list.groups)) continue
    for (const group of list.groups) {
      if (!isRecord(group) || !Array.isArray(group.users)) continue
      for (const user of group.users) {
        if (!isRecord(user)) { skipped++; continue }
        const rawId = user.id
        const id = typeof rawId === "number" || typeof rawId === "string"
          ? String(rawId).trim()
          : ""
        if (!id) { skipped++; continue }
        const previous = followers.get(id)
        followers.set(id, {
          id,
          handle: optionalString(user.handle) ?? previous?.handle ?? null,
          name: optionalString(user.name ?? user.user_name) ?? previous?.name ?? null,
          photo_url: optionalString(user.photo_url ?? user.user_photo_url) ?? previous?.photo_url ?? null,
          isSubscribed: optionalBoolean(user.is_subscribed) || previous?.isSubscribed === true,
        })
      }
    }
  }
  return { followers: [...followers.values()], skipped }
}

/** Apply the owner's complete following list without conflating it with inbound followers. */
export async function applyFollowingSnapshot(
  client: PoolClient,
  userId: string,
  following: FollowerListItem[],
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
  const result = await client.query(
    `with updated as (
       update people p
       set is_following = (
             (p.substack_profile_id is not null and p.substack_profile_id = any($2::text[]))
             or (p.normalized_handle is not null and p.normalized_handle = any($3::text[]))
           ),
           is_subscribed_to = (
             (p.substack_profile_id is not null and p.substack_profile_id = any($4::text[]))
             or (p.normalized_handle is not null and p.normalized_handle = any($5::text[]))
           ),
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
    [userId, profileIds, handles, subscribedProfileIds, subscribedHandles],
  )
  return {
    checked: result.rows[0]?.checked ?? 0,
    following: result.rows[0]?.following ?? 0,
    subscribed: result.rows[0]?.subscribed ?? 0,
  }
}

/** Import and apply the owner's complete follower snapshot atomically. */
export async function applyFollowerSnapshot(
  client: PoolClient,
  userId: string,
  followers: FollowerListItem[],
) {
  const profileIds = followers.map((follower) => follower.id)
  const handles = followers
    .map((follower) => follower.handle ? normalizeHandle(follower.handle) : null)
    .filter((handle): handle is string => Boolean(handle))
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`audience:${userId}`])

  let matched = 0
  let created = 0
  for (const follower of followers) {
    const profileId = follower.id.trim()
    if (!profileId) continue
    const rawHandle = follower.handle?.trim().replace(/^@/, "") || null
    const normalized = rawHandle ? normalizeHandle(rawHandle) : null
    const existing = await client.query(
      `select id from people
       where user_id = $1 and archived_at is null
         and (substack_profile_id = $2
           or ($3::text is not null and normalized_handle = $3))
       order by case when substack_profile_id = $2 then 0 else 1 end
       limit 1`,
      [userId, profileId, normalized],
    )

    if (existing.rows[0]) {
      await client.query(
        `update people
         set is_follower = true,
             substack_profile_id = coalesce(substack_profile_id, $2),
             avatar_url = coalesce(avatar_url, $3),
             follower_checked_at = now(),
             updated_at = now()
         where id = $1`,
        [existing.rows[0].id, profileId, follower.photo_url ?? null],
      )
      matched++
      continue
    }

    const personId = randomUUID()
    const inserted = await client.query(
      `insert into people
          (id, user_id, name, handle, normalized_handle, profile_url,
           substack_profile_id, avatar_url, is_follower, follower_checked_at, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, now(), 'followers')
       on conflict do nothing`,
      [
        personId,
        userId,
        follower.name?.trim() || rawHandle || `Follower ${profileId}`,
        rawHandle,
        normalized,
        normalized ? `https://substack.com/@${encodeURIComponent(normalized)}` : null,
        profileId,
        follower.photo_url ?? null,
      ],
    )
    if (!inserted.rowCount) {
      const raced = await client.query(
        `update people
         set is_follower = true, follower_checked_at = now(), updated_at = now()
         where user_id = $1 and archived_at is null
           and (substack_profile_id = $2
             or ($3::text is not null and normalized_handle = $3))`,
        [userId, profileId, normalized],
      )
      matched += raced.rowCount ?? 0
      continue
    }
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
       set is_follower = (
             (p.substack_profile_id is not null and p.substack_profile_id = any($2::text[]))
             or (p.normalized_handle is not null and p.normalized_handle = any($3::text[]))
           ),
           follower_checked_at = now(),
           updated_at = case when p.is_follower is distinct from (
             (p.substack_profile_id is not null and p.substack_profile_id = any($2::text[]))
             or (p.normalized_handle is not null and p.normalized_handle = any($3::text[]))
           ) then now() else p.updated_at end
       where p.user_id = $1 and p.archived_at is null
         and (p.normalized_handle is not null or p.substack_profile_id is not null)
       returning is_follower
     )
     select count(*)::int as checked,
            count(*) filter (where is_follower)::int as followers
     from updated`,
    [userId, profileIds, handles],
  )
  return {
    checked: result.rows[0]?.checked ?? 0,
    followers: result.rows[0]?.followers ?? 0,
    processed: followers.length,
    matched,
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

  for (const sub of subscribers) {
    const substackProfileId = sub.id ? String(sub.id).trim() : null
    if (!substackProfileId) {
      skipped++
      continue
    }
    const rawHandle = sub.handle?.trim()
    const handle = rawHandle ? rawHandle.replace(/^@/, "") : null
    const normalized = handle ? normalizeHandle(handle) : null
    const name = sub.name?.trim() || handle || `Subscriber ${substackProfileId}`
    const avatarUrl = sub.photo_url || null
    const parsedSubscribedAt = sub.subscription_created_at
      ? new Date(sub.subscription_created_at)
      : null
    const subscribedAt = parsedSubscribedAt && !Number.isNaN(parsedSubscribedAt.getTime())
      ? parsedSubscribedAt.toISOString()
      : null
    const tier = sub.subscription_type || "free"

    const found = await client.query(
      `select id from people
       where user_id = $1 and archived_at is null
         and (($2::text is not null and substack_profile_id = $2)
           or ($3::text is not null and normalized_handle = $3)
           or (
             $4::text is not null and length($4) > 1
             and lower(trim(name)) = lower(trim($4))
             and $5::text is not null and avatar_url = $5
             and $5 not like '%bbff95e7-e97f-4df2-b99c-d492da3b8601%'
             and $5 not like '%default%'
           ))
       order by case
         when substack_profile_id = $2 then 0
         when normalized_handle = $3 then 1
         else 2
       end
       limit 1`,
      [userId, substackProfileId, normalized, name, avatarUrl]
    )

    if (found.rows[0]) {
      await client.query(
        `update people
         set is_subscriber = true,
             subscribed_at = coalesce(subscribed_at, $2::timestamptz),
             subscription_tier = coalesce($3, subscription_tier),
             substack_profile_id = coalesce(substack_profile_id, $4),
             avatar_url = coalesce(avatar_url, $5),
             subscriber_checked_at = coalesce($6::timestamptz, subscriber_checked_at),
             updated_at = now()
         where id = $1`,
        [found.rows[0].id, subscribedAt, tier, substackProfileId, avatarUrl, observedAt ?? null]
      )
      matched++
      continue
    }

    const newId = randomUUID()
    const inserted = await client.query(
      `insert into people
          (id, user_id, name, handle, normalized_handle, profile_url,
           substack_profile_id, avatar_url, is_subscriber, subscribed_at,
           subscription_tier, subscriber_checked_at, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::timestamptz, $10,
               $11::timestamptz, 'subscribers')
       on conflict do nothing`,
      [
        newId, userId, name, handle, normalized,
        normalized ? `https://substack.com/@${encodeURIComponent(normalized)}` : null,
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
