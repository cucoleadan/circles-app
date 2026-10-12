import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"

import { driftStatusSql } from "@workspace/core"

import { withTenant } from "./tenant.js"

export type PoolLike = PoolClient

const personColumns = `p.id, p.name, p.handle, p.notes,
    p.relationship_status as "relationshipStatus",
    p.substack_profile_id as "substackProfileId", p.profile_url as "profileUrl",
    p.publication_url as "publicationUrl",
    p.avatar_url as "avatarUrl",
    coalesce(p.is_follower, false) as "isFollower",
    coalesce(p.is_following, false) as "isFollowing",
    coalesce(p.is_subscriber, false) as "isSubscriber",
    coalesce(p.is_subscribed_to, false) as "isSubscribedTo",
    p.subscribed_at as "subscribedAt",
    p.subscription_tier as "subscriptionTier",
    p.source, p.created_at as "createdAt", p.updated_at as "updatedAt",
    p.archived_at as "archivedAt"`

const personStatsColumns = `coalesce(s.interaction_count, 0) as "interactionCount",
    coalesce(s.conversation_count, 0) as "conversationCount",
    coalesce(s.engagement_score, 0) as "engagementScore",
    coalesce(s.inbound_interaction_count, 0) as "inboundInteractionCount",
    coalesce(s.outbound_interaction_count, 0) as "outboundInteractionCount",
    coalesce(s.outbound_engagement_score, 0) as "outboundEngagementScore",
    s.first_interacted_at as "firstInteractedAt",
    s.last_interaction_at as "lastInteractionAt",
    s.last_inbound_at as "lastInboundAt",
    s.last_outbound_at as "lastOutboundAt",
    s.last_conversation_at as "lastConversationAt",
    ${driftStatusSql("s.last_interaction_at")} as "driftStatus"`

// insert/update RETURNING clauses cannot use the `p.` table alias
const plainPersonColumns = personColumns.replaceAll("p.", "")

export interface PersonTag {
  id: string
  name: string
  color: string | null
}

export interface PersonList {
  id: string
  name: string
  createdAt?: string | null
}

export interface Person {
  id: string
  name: string
  handle: string | null
  notes: string | null
  relationshipStatus: string | null
  substackProfileId: string | null
  profileUrl: string | null
  publicationUrl?: string | null
  avatarUrl?: string | null
  isFollower?: boolean
  isFollowing?: boolean
  isSubscriber?: boolean
  isSubscribedTo?: boolean
  subscribedAt?: string | null
  subscriptionTier?: string | null
  source: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface PersonWithStats extends Person {
  interactionCount: number
  conversationCount: number
  engagementScore: number
  inboundInteractionCount: number
  outboundInteractionCount: number
  outboundEngagementScore: number
  firstInteractedAt: string | null
  lastInteractionAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  lastConversationAt: string | null
  driftStatus: string
  lastActionType?: string | null
  lastActionDirection?: string | null
  lastInboundCommentAt?: string | null
  lastOutboundCommentAt?: string | null
  lastOutboundLikeAt?: string | null
  likeCount?: number
  restackCount?: number
  commentCount?: number
  tags?: PersonTag[]
  lists?: PersonList[]
}

export interface PersonInput {
  name?: string
  handle?: string | null
  notes?: string | null
  relationshipStatus?: string | null
  substackProfileId?: string | null
  profileUrl?: string | null
  publicationUrl?: string | null
  avatarUrl?: string | null
  isFollower?: boolean
  isFollowing?: boolean
  isSubscriber?: boolean
  isSubscribedTo?: boolean
  subscribedAt?: string | null
  subscriptionTier?: string | null
}

export const normalizeHandle = (handle: string) =>
  handle.trim().replace(/^@/, "").toLowerCase()

// ---------------------------------------------------------------- app users

export async function getOrCreateAppUser(authUserId: string): Promise<string> {
  return withTenant({ authUserId }, async (client) => {
    const found = await client.query(
      "select id from app_users where auth_user_id = $1",
      [authUserId]
    )
    if (found.rows[0]) return found.rows[0].id as string

    const id = randomUUID()
    const inserted = await client.query(
      `insert into app_users (id, auth_user_id) values ($1, $2)
       on conflict (auth_user_id) do nothing returning id`,
      [id, authUserId]
    )
    if (inserted.rows[0]) return inserted.rows[0].id as string

    const raced = await client.query(
      "select id from app_users where auth_user_id = $1",
      [authUserId]
    )
    return raced.rows[0].id as string
  })
}

// ---------------------------------------------------------------- user settings

export interface PriorityQueueSettings {
  minInbound: number
  maxOutbound: number
  minRestacks: number
  driftingMinDays: number
  driftingMaxDays: number
  vipScoreThreshold: number
}

export interface UserSettings {
  priorityQueue: PriorityQueueSettings
}

export const defaultUserSettings: UserSettings = {
  priorityQueue: {
    minInbound: 2,
    maxOutbound: 1,
    minRestacks: 1,
    driftingMinDays: 21,
    driftingMaxDays: 90,
    vipScoreThreshold: 12,
  },
}

export async function getUserSettings(client: PoolLike): Promise<UserSettings> {
  const res = await client.query(
    `select settings from app_users where id = current_setting('app.user_id', true)`
  )
  const stored = res.rows[0]?.settings ?? {}
  return {
    priorityQueue: {
      ...defaultUserSettings.priorityQueue,
      ...(stored.priorityQueue ?? {}),
    },
  }
}

export async function updateUserSettings(
  client: PoolLike,
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const current = await getUserSettings(client)
  const updated: UserSettings = {
    priorityQueue: {
      ...current.priorityQueue,
      ...(patch.priorityQueue ?? {}),
    },
  }
  await client.query(
    `update app_users set settings = $1, updated_at = now() where id = current_setting('app.user_id', true)`,
    [JSON.stringify(updated)]
  )
  return updated
}

// ------------------------------------------------------------------- people

export type PeopleView =
  | "all"
  | "needs-reply"
  | "awaiting-response"
  | "mutual"
  | "priority"
  | "conversations"
  | "inbound"
  | "outbound"
  | "no-history"
  | "opportunities"
  | "follows-not-subscribed"
  | "ignored"

export type PeopleSort =
  | "engagement"
  | "recent_conversation"
  | "recent_interaction"
  | "name"
  | "inbound"
  | "outbound"
  | "priority"

export async function listPeople(
  client: PoolLike,
  options: {
    search?: string
    status?: string
    tagId?: string
    listId?: string
    view?: PeopleView | string
    sort?: PeopleSort | string
    since?: string
    until?: string
    limit?: number
    offset?: number
    hasRestack?: boolean
    hasComment?: boolean
    hasLike?: boolean
    actionType?: "restack" | "comment" | "like" | "all" | string
  } = {}
): Promise<PersonWithStats[]> {
  const limit = Math.min(Math.max(options.limit ?? 1000, 1), 5000)
  const conditions = ["p.archived_at is null"]
  const params: unknown[] = []
  if (options.search) {
    params.push(`%${options.search.toLowerCase()}%`)
    conditions.push(
      `(lower(p.name) like $${params.length} or lower(p.handle) like $${params.length})`
    )
  }
  if (options.status) {
    params.push(options.status)
    conditions.push(`p.relationship_status = $${params.length}`)
  }
  if (options.tagId) {
    params.push(options.tagId)
    conditions.push(
      `exists (select 1 from person_tags pt where pt.person_id = p.id and pt.tag_id = $${params.length})`
    )
  }
  let selectedIgnoredList = false
  if (options.listId) {
    params.push(options.listId)
    conditions.push(
      `exists (select 1 from list_members lm where lm.person_id = p.id and lm.list_id = $${params.length})`
    )
    const selectedList = await client.query(
      "select lower(name) = 'ignored' as ignored from lists where id = $1",
      [options.listId]
    )
    selectedIgnoredList = selectedList.rows[0]?.ignored === true
  }

  // Ignored contacts isolation:
  // Contacts in the "Ignored" list are hidden from the entire CRM,
  // appearing ONLY when explicitly viewing the "ignored" tab.
  if (options.view === "ignored" || selectedIgnoredList) {
    conditions.push(
      `exists (
        select 1 from list_members lm
        join lists l on l.id = lm.list_id
        where lm.person_id = p.id and lower(l.name) = 'ignored'
      )`
    )
  } else {
    conditions.push(
      `not exists (
        select 1 from list_members lm
        join lists l on l.id = lm.list_id
        where lm.person_id = p.id and lower(l.name) = 'ignored'
      )`
    )
  }

  if (options.view === "conversations") {
    conditions.push("coalesce(s.conversation_count, 0) > 0")
  } else if (options.view === "needs-reply") {
    // Needs reply if they commented last AND you haven't liked or replied since
    conditions.push(
      `(act_counts."lastInboundCommentAt" is not null
        and (act_counts."lastOutboundCommentAt" is null or act_counts."lastInboundCommentAt" > act_counts."lastOutboundCommentAt")
        and not (
          (last_act."lastActionDirection" = 'outbound' and last_act."lastActionType" = 'like')
          or (act_counts."lastOutboundLikeAt" is not null and act_counts."lastOutboundLikeAt" > act_counts."lastInboundCommentAt")
        ))`
    )
  } else if (options.view === "awaiting-response") {
    conditions.push(
      "(act_counts.\"lastOutboundCommentAt\" is not null and act_counts.\"lastOutboundCommentAt\" >= now() - interval '7 days' and (act_counts.\"lastInboundCommentAt\" is null or act_counts.\"lastOutboundCommentAt\" > act_counts.\"lastInboundCommentAt\"))"
    )
  } else if (options.view === "mutual") {
    conditions.push(
      "(coalesce(s.inbound_interaction_count, 0) > 0 and coalesce(s.outbound_interaction_count, 0) > 0)"
    )
  } else if (options.view === "priority") {
    const settings = await getUserSettings(client)
    const q = settings.priorityQueue
    params.push(q.minInbound)
    const pMinInbound = params.length
    params.push(q.maxOutbound)
    const pMaxOutbound = params.length
    params.push(q.minRestacks)
    const pMinRestacks = params.length
    params.push(q.driftingMinDays)
    const pDriftMin = params.length
    params.push(q.driftingMaxDays)
    const pDriftMax = params.length
    params.push(q.vipScoreThreshold)
    const pVipScore = params.length

    conditions.push(
      `((coalesce(s.inbound_interaction_count, 0) >= $${pMinInbound} and coalesce(s.outbound_interaction_count, 0) <= $${pMaxOutbound})
        or (coalesce(act_counts."restackCount", 0) >= $${pMinRestacks} and (s.last_outbound_at is null or s.last_outbound_at < s.last_inbound_at))
        or (coalesce(s.engagement_score, 0) >= $${pVipScore} and s.last_interaction_at < now() - ($${pDriftMin} || ' days')::interval and s.last_interaction_at >= now() - ($${pDriftMax} || ' days')::interval))`
    )
  } else if (options.view === "inbound") {
    conditions.push("s.last_inbound_at is not null")
  } else if (options.view === "outbound") {
    conditions.push("s.last_outbound_at is not null")
  } else if (options.view === "no-history") {
    conditions.push("coalesce(s.interaction_count, 0) = 0")
  } else if (options.view === "opportunities") {
    conditions.push(
      "(coalesce(s.engagement_score, 0) > 0 and s.last_interaction_at < now() - interval '14 days')"
    )
  } else if (options.view === "follows-not-subscribed") {
    conditions.push("(p.is_follower = true and coalesce(p.is_subscriber, false) = false)")
  }

  // Advanced Interaction Filters
  if (options.hasRestack || options.actionType === "restack") {
    conditions.push(`coalesce(act_counts."restackCount", 0) > 0`)
  }
  if (options.hasComment || options.actionType === "comment") {
    conditions.push(`coalesce(act_counts."commentCount", 0) > 0`)
  }
  if (options.hasLike || options.actionType === "like") {
    conditions.push(`coalesce(act_counts."likeCount", 0) > 0`)
  }

  const dateColumn =
    options.view === "conversations" ? "s.last_conversation_at" :
    options.view === "needs-reply" ? "act_counts.\"lastInboundCommentAt\"" :
    options.view === "awaiting-response" ? "act_counts.\"lastOutboundCommentAt\"" :
    options.view === "priority" ? "s.last_inbound_at" :
    options.view === "inbound" ? "s.last_inbound_at" :
    options.view === "outbound" ? "s.last_outbound_at" :
    "s.last_interaction_at"

  if (options.since) {
    params.push(options.since)
    conditions.push(`${dateColumn} >= $${params.length}`)
  }
  if (options.until) {
    params.push(options.until)
    conditions.push(`${dateColumn} <= $${params.length}`)
  }

  const sort = options.sort ?? (
    options.view === "conversations" ? "recent_conversation" :
    options.view === "needs-reply" ? "needs_reply" :
    options.view === "awaiting-response" ? "awaiting_response" :
    options.view === "priority" ? "priority" :
    options.view === "inbound" ? "inbound" :
    options.view === "outbound" ? "outbound" :
    options.view === "opportunities" ? "engagement" :
    "engagement"
  )

  let orderBy = "coalesce(s.engagement_score, 0) desc, s.last_interaction_at desc nulls last, lower(p.name)"
  if (sort === "recent_conversation") {
    orderBy = "s.last_conversation_at desc nulls last, s.last_interaction_at desc nulls last, lower(p.name)"
  } else if (sort === "needs_reply" || options.view === "needs-reply") {
    orderBy = "act_counts.\"lastInboundCommentAt\" desc nulls last, lower(p.name)"
  } else if (sort === "awaiting_response" || options.view === "awaiting-response") {
    orderBy = "act_counts.\"lastOutboundCommentAt\" desc nulls last, lower(p.name)"
  } else if (sort === "priority" || options.view === "priority") {
    orderBy = "(coalesce(s.inbound_interaction_count, 0) - coalesce(s.outbound_interaction_count, 0)) desc, coalesce(s.engagement_score, 0) desc, s.last_inbound_at desc nulls last, lower(p.name)"
  } else if (sort === "recent_interaction" || sort === "recent_interaction_desc") {
    orderBy = "s.last_interaction_at desc nulls last, lower(p.name)"
  } else if (sort === "recent_interaction_asc") {
    orderBy = "s.last_interaction_at asc nulls last, lower(p.name)"
  } else if (sort === "inbound" || sort === "inbound_desc") {
    orderBy = "s.last_inbound_at desc nulls last, lower(p.name)"
  } else if (sort === "inbound_asc") {
    orderBy = "s.last_inbound_at asc nulls last, lower(p.name)"
  } else if (sort === "outbound" || sort === "outbound_desc") {
    orderBy = "s.last_outbound_at desc nulls last, lower(p.name)"
  } else if (sort === "outbound_asc") {
    orderBy = "s.last_outbound_at asc nulls last, lower(p.name)"
  } else if (sort === "engagement_asc") {
    orderBy = "coalesce(s.engagement_score, 0) asc, s.last_interaction_at asc nulls last, lower(p.name)"
  } else if (sort === "name") {
    orderBy = "lower(p.name), p.id"
  }

  params.push(limit)
  const limitParam = params.length

  let offsetClause = ""
  if (options.offset && options.offset > 0) {
    params.push(options.offset)
    offsetClause = ` offset $${params.length}`
  }

  const result = await client.query(
    `select ${personColumns}, ${personStatsColumns},
       last_act."lastActionType",
       last_act."lastActionDirection",
       act_counts."lastInboundCommentAt",
       act_counts."lastOutboundCommentAt",
       act_counts."lastOutboundLikeAt",
       coalesce(act_counts."likeCount", 0)::int as "likeCount",
       coalesce(act_counts."restackCount", 0)::int as "restackCount",
       coalesce(act_counts."commentCount", 0)::int as "commentCount",
       coalesce((
         select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by lower(t.name))
         from person_tags pt join tags t on t.id = pt.tag_id
         where pt.person_id = p.id
       ), '[]'::json) as tags,
       coalesce((
         select json_agg(json_build_object('id', l.id, 'name', l.name, 'createdAt', lm.created_at) order by lower(l.name))
         from list_members lm join lists l on l.id = lm.list_id
         where lm.person_id = p.id
       ), '[]'::json) as lists
      from people p
      left join relationship_stats s on s.person_id = p.id
      left join lateral (
        select action_type as "lastActionType", direction as "lastActionDirection"
        from interactions
        where person_id = p.id and removed_at is null
        order by occurred_at desc, id desc
        limit 1
      ) last_act on true
      left join lateral (
        select
          max(occurred_at) filter (where direction = 'inbound' and action_type in ('comment', 'reply')) as "lastInboundCommentAt",
          max(occurred_at) filter (where direction = 'outbound' and action_type in ('comment', 'reply')) as "lastOutboundCommentAt",
          max(occurred_at) filter (where direction = 'outbound' and action_type = 'like') as "lastOutboundLikeAt",
          count(*) filter (where action_type = 'like') as "likeCount",
          count(*) filter (where action_type = 'restack') as "restackCount",
          count(*) filter (where action_type in ('comment', 'reply')) as "commentCount"
        from interactions
        where person_id = p.id and removed_at is null
      ) act_counts on true
      where ${conditions.join(" and ")}
      order by ${orderBy}
      limit $${limitParam}${offsetClause}`,
    params
  )
  return result.rows as PersonWithStats[]
}

export async function getPerson(
  client: PoolLike,
  personId: string
): Promise<{
  person: PersonWithStats
  tags: PersonTag[]
  lists: PersonList[]
} | null> {
  const person = await client.query(
    `select ${personColumns}, ${personStatsColumns},
       last_act."lastActionType",
       last_act."lastActionDirection",
       act_counts."lastInboundCommentAt",
       act_counts."lastOutboundCommentAt",
       act_counts."lastOutboundLikeAt",
       coalesce(act_counts."likeCount", 0)::int as "likeCount",
       coalesce(act_counts."restackCount", 0)::int as "restackCount",
       coalesce(act_counts."commentCount", 0)::int as "commentCount"
      from people p
      left join relationship_stats s on s.person_id = p.id
      left join lateral (
        select action_type as "lastActionType", direction as "lastActionDirection"
        from interactions
        where person_id = p.id and removed_at is null
        order by occurred_at desc, id desc
        limit 1
      ) last_act on true
      left join lateral (
        select
          max(occurred_at) filter (where direction = 'inbound' and action_type in ('comment', 'reply')) as "lastInboundCommentAt",
          max(occurred_at) filter (where direction = 'outbound' and action_type in ('comment', 'reply')) as "lastOutboundCommentAt",
          max(occurred_at) filter (where direction = 'outbound' and action_type = 'like') as "lastOutboundLikeAt",
          count(*) filter (where action_type = 'like') as "likeCount",
          count(*) filter (where action_type = 'restack') as "restackCount",
          count(*) filter (where action_type in ('comment', 'reply')) as "commentCount"
        from interactions
        where person_id = p.id and removed_at is null
      ) act_counts on true
      where p.id = $1 and p.archived_at is null`,
    [personId]
  )
  if (!person.rows[0]) return null

  const tags = await client.query(
    `select t.id, t.name, t.color from person_tags pt
       join tags t on t.id = pt.tag_id
      where pt.person_id = $1 order by lower(t.name)`,
    [personId]
  )
  const lists = await client.query(
    `select l.id, l.name, lm.created_at as "createdAt" from list_members lm
       join lists l on l.id = lm.list_id
      where lm.person_id = $1 order by lower(l.name)`,
    [personId]
  )
  const foundPerson = {
    ...person.rows[0],
    tags: tags.rows,
    lists: lists.rows,
  }
  return { person: foundPerson, tags: tags.rows, lists: lists.rows }
}

export async function createPerson(
  client: PoolLike,
  userId: string,
  input: PersonInput
): Promise<Person> {
  const handle = input.handle?.trim() ? input.handle : null
  const normalizedHandle = handle ? normalizeHandle(handle) : null
  const profileUrl = input.profileUrl ?? (normalizedHandle && /^[a-z0-9._-]+$/i.test(normalizedHandle)
    ? `https://substack.com/@${encodeURIComponent(normalizedHandle)}`
    : null)
  const result = await client.query(
    `insert into people
        (id, user_id, name, handle, normalized_handle, notes, relationship_status,
         substack_profile_id, profile_url, avatar_url,
         is_follower, is_following, is_subscriber, is_subscribed_to, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'manual')
     returning ${plainPersonColumns}`,
    [
      randomUUID(),
      userId,
      input.name ?? (handle || "Unnamed Contact"),
      handle,
      normalizedHandle,
      input.notes ?? null,
      input.relationshipStatus ?? null,
      input.substackProfileId ?? null,
      profileUrl,
      input.avatarUrl ?? null,
      input.isFollower ?? false,
      input.isFollowing ?? false,
      input.isSubscriber ?? false,
      input.isSubscribedTo ?? false,
    ]
  )
  return result.rows[0]
}

export async function updatePerson(
  client: PoolLike,
  personId: string,
  input: PersonInput
): Promise<Person | null> {
  const updates: string[] = ["updated_at = now()"]
  const params: unknown[] = [personId]

  if (input.name !== undefined && input.name !== null) {
    params.push(input.name)
    updates.push(`name = $${params.length}`)
  }
  if (input.handle !== undefined) {
    const handle = input.handle?.trim() ? input.handle : null
    params.push(handle)
    updates.push(`handle = $${params.length}`)
    params.push(handle ? normalizeHandle(handle) : null)
    updates.push(`normalized_handle = $${params.length}`)
  }
  if (input.notes !== undefined) {
    params.push(input.notes)
    updates.push(`notes = $${params.length}`)
  }
  if (input.relationshipStatus !== undefined) {
    params.push(input.relationshipStatus)
    updates.push(`relationship_status = $${params.length}`)
  }
  if (input.substackProfileId !== undefined) {
    params.push(input.substackProfileId)
    updates.push(`substack_profile_id = $${params.length}`)
  }
  if (input.profileUrl !== undefined) {
    params.push(input.profileUrl)
    updates.push(`profile_url = $${params.length}`)
  }
  if (input.publicationUrl !== undefined) {
    params.push(input.publicationUrl)
    updates.push(`publication_url = $${params.length}`)
  }
  if (input.avatarUrl !== undefined) {
    params.push(input.avatarUrl)
    updates.push(`avatar_url = $${params.length}`)
  }
  if (input.isFollower !== undefined) {
    params.push(input.isFollower)
    updates.push(`is_follower = $${params.length}`)
  }
  if (input.isFollowing !== undefined) {
    params.push(input.isFollowing)
    updates.push(`is_following = $${params.length}`)
  }
  if (input.isSubscriber !== undefined) {
    params.push(input.isSubscriber)
    updates.push(`is_subscriber = $${params.length}`)
  }
  if (input.isSubscribedTo !== undefined) {
    params.push(input.isSubscribedTo)
    updates.push(`is_subscribed_to = $${params.length}`)
  }
  if (input.subscribedAt !== undefined) {
    params.push(input.subscribedAt)
    updates.push(`subscribed_at = $${params.length}::timestamptz`)
  }
  if (input.subscriptionTier !== undefined) {
    params.push(input.subscriptionTier)
    updates.push(`subscription_tier = $${params.length}`)
  }

  const result = await client.query(
    `update people
        set ${updates.join(", ")}
      where id = $1 and archived_at is null
      returning ${plainPersonColumns}`,
    params
  )
  return result.rows[0] ?? null
}

export async function archivePerson(
  client: PoolLike,
  personId: string
): Promise<boolean> {
  const result = await client.query(
    `update people set archived_at = now(), updated_at = now()
      where id = $1 and archived_at is null returning id`,
    [personId]
  )
  return Boolean(result.rows[0])
}

export async function audit(
  client: PoolLike,
  userId: string,
  action: string,
  subjectType: string,
  subjectId: string
) {
  await client.query(
    `insert into audit_log (user_id, action, subject_type, subject_id)
     values ($1, $2, $3, $4)`,
    [userId, action, subjectType, subjectId]
  )
}

// ------------------------------------------------------------- interactions

export interface InteractionInput {
  externalId: string
  personId?: string | null
  connectionId?: string | null
  source?: "extension" | "sdk" | "import"
  direction: "inbound" | "outbound"
  actionType: string
  targetType?: string | null
  targetId?: string | null
  targetTitle?: string | null
  targetBody?: string | null
  targetUrl?: string | null
  threadKind?: "post" | "note" | null
  threadRootId?: string | null
  body?: string | null
  occurredAt: string
  metadata?: Record<string, unknown>
}

export interface InteractionRow {
  id: string
  externalId: string
  personId: string | null
  connectionId: string | null
  source: string
  direction: string
  actionType: string
  targetType: string | null
  targetId: string | null
  targetTitle: string | null
  targetBody: string | null
  targetUrl: string | null
  threadKind: string | null
  threadRootId: string | null
  body: string | null
  occurredAt: string
  metadata: Record<string, unknown>
  createdAt: string
}

const interactionColumns = `id, external_id as "externalId", person_id as "personId",
    connection_id as "connectionId", source, direction, action_type as "actionType",
    target_type as "targetType", target_id as "targetId", target_title as "targetTitle",
    target_body as "targetBody", target_url as "targetUrl", thread_kind as "threadKind",
    thread_root_id as "threadRootId", body, occurred_at as "occurredAt",
    metadata, created_at as "createdAt"`

export async function recordInteraction(
  client: PoolLike,
  userId: string,
  input: InteractionInput
): Promise<InteractionRow | null> {
  const result = await client.query(
    `insert into interactions
        (id, user_id, connection_id, person_id, external_id, source, direction,
         action_type, target_type, target_id, target_title, target_url,
         target_body, thread_kind, thread_root_id, body, occurred_at, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     on conflict do nothing
     returning ${interactionColumns}`,
    [
      randomUUID(),
      userId,
      input.connectionId ?? null,
      input.personId ?? null,
      input.externalId,
      input.source ?? "extension",
      input.direction,
      input.actionType,
      input.targetType ?? null,
      input.targetId ?? null,
      input.targetTitle ?? null,
      input.targetUrl ?? null,
      input.targetBody ?? null,
      input.threadKind ?? null,
      input.threadRootId ?? null,
      input.body ?? null,
      input.occurredAt,
      JSON.stringify(input.metadata ?? {}),
    ]
  )
  return result.rows[0] ?? null
}

export interface InteractionPage {
  interactions: InteractionRow[]
  nextCursor: string | null
}

export const encodeCursor = (occurredAt: string, id: string) =>
  Buffer.from(JSON.stringify({ o: occurredAt, d: id })).toString("base64url")

export const decodeCursor = (cursor: string) => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString())
    if (typeof parsed?.o === "string" && Number.isFinite(Date.parse(parsed.o)) &&
        typeof parsed.d === "string" && parsed.d.length > 0 && parsed.d.length <= 200) return parsed
  } catch {
    /* fall through */
  }
  return null
}

export async function personInteractions(
  client: PoolLike,
  personId: string,
  options: { cursor?: string; limit?: number } = {}
): Promise<InteractionPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100)
  const params: unknown[] = [personId]
  let where = "person_id = $1 and removed_at is null"
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor)
    if (!cursor) throw new Error("Invalid cursor")
    params.push(cursor.o, cursor.d)
    where += ` and (occurred_at, id) < ($2, $3)`
  }
  params.push(limit)

  const result = await client.query(
    `select ${interactionColumns}
      from interactions
      where ${where}
      order by occurred_at desc, id desc
      limit $${params.length}`,
    params
  )

  const rows = result.rows
  const nextCursor =
    rows.length === limit && rows.length > 0
      ? encodeCursor(rows[rows.length - 1].occurredAt, rows[rows.length - 1].id)
      : null
  return { interactions: rows, nextCursor }
}

/** Per-person totals are rebuilt by the canonical ingestion module. */
export { refreshPersonStats } from "@workspace/core"

// ------------------------------------------------------------ lists and tags

export interface NamedRecord {
  id: string
  name: string
  description?: string | null
  createdAt: string
  count: number
}

export async function listLists(client: PoolLike): Promise<NamedRecord[]> {
  const result = await client.query(
    `select l.id, l.name, l.description, l.created_at as "createdAt",
        count(p.id)::int as count
      from lists l
      left join list_members lm on lm.list_id = l.id
      left join people p on p.id = lm.person_id
        and p.archived_at is null
        and (lower(l.name) = 'ignored' or not exists (
          select 1 from list_members ignored_member
          join lists ignored_list on ignored_list.id = ignored_member.list_id
          where ignored_member.person_id = p.id
            and lower(ignored_list.name) = 'ignored'
        ))
      group by l.id order by lower(l.name)`
  )
  return result.rows
}

export async function createList(
  client: PoolLike,
  userId: string,
  name: string,
  description?: string | null
): Promise<{ id: string; name: string }> {
  const result = await client.query(
    `insert into lists (id, user_id, name, normalized_name, description)
     values ($1, $2, $3, lower($3), $4) returning id, name`,
    [randomUUID(), userId, name, description ?? null]
  )
  return result.rows[0]
}

export async function updateList(
  client: PoolLike,
  listId: string,
  name: string,
  description?: string | null
): Promise<{ id: string; name: string } | null> {
  const result = await client.query(
    `update lists set name = $2, normalized_name = lower($2), description = $3,
        updated_at = now()
      where id = $1 returning id, name`,
    [listId, name, description ?? null]
  )
  return result.rows[0] ?? null
}

/** Deleting a list only removes the membership edges, never people. */
export async function deleteList(client: PoolLike, listId: string): Promise<boolean> {
  const result = await client.query(
    "delete from lists where id = $1 returning id",
    [listId]
  )
  return Boolean(result.rows[0])
}

export async function addListMember(
  client: PoolLike,
  userId: string,
  listId: string,
  personId: string
) {
  await client.query(
    `insert into list_members (list_id, person_id, user_id) values ($1, $2, $3)
     on conflict (list_id, person_id) do nothing`,
    [listId, personId, userId]
  )
}

export async function removeListMember(
  client: PoolLike,
  listId: string,
  personId: string
) {
  await client.query(
    "delete from list_members where list_id = $1 and person_id = $2",
    [listId, personId]
  )
}

export async function listTags(client: PoolLike): Promise<NamedRecord[]> {
  const result = await client.query(
    `select t.id, t.name, t.created_at as "createdAt",
        count(pt.person_id)::int as count
      from tags t left join person_tags pt on pt.tag_id = t.id
      group by t.id order by lower(t.name)`
  )
  return result.rows
}

export async function createTag(
  client: PoolLike,
  userId: string,
  name: string,
  color?: string | null
): Promise<{ id: string; name: string }> {
  const result = await client.query(
    `insert into tags (id, user_id, name, normalized_name, color)
     values ($1, $2, $3, lower($3), $4) returning id, name`,
    [randomUUID(), userId, name, color ?? "#635bff"]
  )
  return result.rows[0]
}

export async function updateTag(
  client: PoolLike,
  tagId: string,
  name: string,
  color?: string | null
): Promise<{ id: string; name: string } | null> {
  const result = await client.query(
    `update tags set name = $2, normalized_name = lower($2), color = $3,
        updated_at = now()
      where id = $1 returning id, name`,
    [tagId, name, color ?? "#635bff"]
  )
  return result.rows[0] ?? null
}

export async function deleteTag(client: PoolLike, tagId: string): Promise<boolean> {
  const result = await client.query("delete from tags where id = $1 returning id", [
    tagId,
  ])
  return Boolean(result.rows[0])
}

export async function attachTag(
  client: PoolLike,
  userId: string,
  tagId: string,
  personId: string
) {
  await client.query(
    `insert into person_tags (person_id, tag_id, user_id) values ($1, $2, $3)
     on conflict (person_id, tag_id) do nothing`,
    [personId, tagId, userId]
  )
}

export async function detachTag(
  client: PoolLike,
  tagId: string,
  personId: string
) {
  await client.query(
    "delete from person_tags where person_id = $1 and tag_id = $2",
    [personId, tagId]
  )
}

// ------------------------------------------------------------------- circles

export interface CirclesOverview {
  people: number
  byStatus: Record<string, number>
  byDrift: Record<string, number>
  interactions: number
  followsNotSubscribed: number
  ignored: number
}

export async function circlesOverview(client: PoolLike): Promise<CirclesOverview> {
  const people = await client.query(
    `select relationship_status as status, count(*)::int as count
       from people
       where archived_at is null
         and not exists (
           select 1 from list_members lm join lists l on l.id = lm.list_id where lm.person_id = people.id and lower(l.name) = 'ignored'
         )
       group by relationship_status`
  )
  const stats = await client.query(
    `select ${driftStatusSql("s.last_interaction_at")} as status, count(*)::int as count
       from relationship_stats s
       join people p on p.id = s.person_id
       where p.archived_at is null
         and not exists (
           select 1 from list_members lm join lists l on l.id = lm.list_id where lm.person_id = p.id and lower(l.name) = 'ignored'
         )
       group by 1`
  )
  const interactions = await client.query(
    "select count(*)::int as count from interactions where removed_at is null"
  )
  const specialCounts = await client.query(
    `select
       count(*) filter (where p.is_follower = true and coalesce(p.is_subscriber, false) = false and not exists (
         select 1 from list_members lm join lists l on l.id = lm.list_id where lm.person_id = p.id and lower(l.name) = 'ignored'
       ))::int as follows_not_subscribed,
       count(*) filter (where exists (
         select 1 from list_members lm join lists l on l.id = lm.list_id where lm.person_id = p.id and lower(l.name) = 'ignored'
       ))::int as ignored
     from people p
     where p.archived_at is null`
  )
  const byStatus: Record<string, number> = {}
  for (const row of people.rows) byStatus[row.status ?? "new"] = row.count
  const byDrift: Record<string, number> = {}
  for (const row of stats.rows) byDrift[row.status] = row.count
  return {
    people: people.rows.reduce((sum: number, row: { count: number }) => sum + row.count, 0),
    byStatus,
    byDrift,
    interactions: interactions.rows[0].count,
    followsNotSubscribed: specialCounts.rows[0]?.follows_not_subscribed ?? 0,
    ignored: specialCounts.rows[0]?.ignored ?? 0,
  }
}
