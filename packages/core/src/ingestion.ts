import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

export type PoolLike = PoolClient

export interface IngestionStats {
  processedItems: number
  newInteractions: number
  newPeople: number
  touchedPeople: number
}

export interface ActivityItemInput {
  id?: string | number
  item_key?: string
  type?: string
  action?: string
  kind?: string
  created_at?: string | number
  createdAt?: string | number
  comment_body?: string | null
  commentBody?: string | null
  comment_id?: string | number | null
  commentId?: string | number | null
  root_comment_id?: string | number | null
  rootCommentId?: string | number | null
  target_kind?: string | null
  targetKind?: string | null
  target_title?: string | null
  targetTitle?: string | null
  target_url?: string | null
  targetUrl?: string | null
  actor?: {
    id?: string | number | null
    name?: string | null
    handle?: string | null
    photo_url?: string | null
    avatarUrl?: string | null
  } | null
  actor_name?: string | null
  actorName?: string | null
  actor_handle?: string | null
  actorHandle?: string | null
  actor_photo_url?: string | null
  actorPhotoUrl?: string | null
}

export interface ConversationCommentInput {
  id: string | number
  body?: string | null
  created_at?: string | number
  createdAt?: string | number
  author_id?: string | number | null
  authorId?: string | number | null
  author_name?: string | null
  authorName?: string | null
  author_handle?: string | null
  authorHandle?: string | null
  author_photo_url?: string | null
  authorPhotoUrl?: string | null
  parent_id?: string | number | null
  parentId?: string | number | null
  children?: ConversationCommentInput[]
}

export interface ConversationInput {
  kind?: string
  targetType?: "note" | "post"
  targetId: string | number
  sourceUrl?: string | null
  comments: ConversationCommentInput[]
  rootAuthor?: {
    id?: string | number | null
    name?: string | null
    handle?: string | null
    avatarUrl?: string | null
  } | null
}

const normalizeHandle = (handle: string) =>
  handle.trim().replace(/^@/, "").toLowerCase()

function parseTimestamp(val: unknown): string {
  if (typeof val === "number") {
    // If seconds, convert to ms
    const ms = val < 1e11 ? val * 1000 : val
    return new Date(ms).toISOString()
  }
  if (typeof val === "string" && val.trim().length > 0) {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function classifyAction(kind: string | undefined, body: string | null | undefined): string {
  if (body && body.trim().length > 0) return "comment"
  const k = (kind ?? "").toLowerCase()
  if (k.includes("restack")) return "restack"
  if (k.includes("like") || k.includes("heart") || k.includes("reaction")) return "like"
  if (k.includes("subscribe")) return "subscribe"
  if (k.includes("mention")) return "mention"
  if (k.includes("reply")) return "reply"
  return "other"
}

export async function ensurePerson(
  client: PoolLike,
  userId: string,
  personCache: Map<string, string>,
  author: { name?: string | null; handle?: string | null; id?: string | number | null }
): Promise<string | null> {
  const rawHandle = author.handle?.trim()
  if (!rawHandle) return null
  const handle = rawHandle.replace(/^@/, "")
  const normalized = normalizeHandle(handle)

  const cached = personCache.get(normalized)
  if (cached) return cached

  // Check database
  const found = await client.query(
    "select id from people where user_id = $1 and normalized_handle = $2 and archived_at is null limit 1",
    [userId, normalized]
  )
  if (found.rows[0]) {
    const id = found.rows[0].id as string
    personCache.set(normalized, id)
    return id
  }

  // Create new person
  const newId = randomUUID()
  const name = author.name?.trim() || handle
  const substackProfileId = author.id ? String(author.id) : null
  const profileUrl = `https://substack.com/@${encodeURIComponent(normalized)}`

  await client.query(
    `insert into people (id, user_id, name, handle, normalized_handle, profile_url, substack_profile_id, source)
     values ($1, $2, $3, $4, $5, $6, $7, 'extension')
     on conflict do nothing`,
    [newId, userId, name, handle, normalized, profileUrl, substackProfileId]
  )

  const check = await client.query(
    "select id from people where user_id = $1 and normalized_handle = $2 and archived_at is null limit 1",
    [userId, normalized]
  )
  const finalId = (check.rows[0]?.id as string) ?? newId
  personCache.set(normalized, finalId)
  return finalId
}

export async function refreshPersonStats(client: PoolLike, personId: string) {
  await client.query(
    `insert into relationship_stats
        (person_id, user_id, interaction_count, conversation_count,
         first_interacted_at, last_interaction_at, last_inbound_at, last_outbound_at,
         last_conversation_at, drift_status, engagement_score, updated_at)
     select i.person_id, i.user_id, count(*),
        count(distinct i.thread_root_id) filter (where i.thread_root_id is not null),
        min(i.occurred_at), max(i.occurred_at),
        max(i.occurred_at) filter (where i.direction = 'inbound'),
        max(i.occurred_at) filter (where i.direction = 'outbound'),
        max(i.occurred_at) filter (where i.thread_root_id is not null),
        case
          when max(i.occurred_at) is null then 'new'
          when max(i.occurred_at) > now() - interval '30 days' then 'active'
          when max(i.occurred_at) > now() - interval '90 days' then 'drifting'
          else 'cold'
        end,
        coalesce(sum(
          case
            when i.action_type = 'like' then 1
            when i.action_type = 'restack' and (i.body is null or trim(i.body) = '') then 2
            when i.action_type = 'restack' then 3
            when i.action_type in ('comment', 'reply') then 3
            else 1
          end
        ), 0)::int,
        now()
      from interactions i
      where i.person_id = $1
      group by i.person_id, i.user_id
     on conflict (person_id) do update
      set interaction_count = excluded.interaction_count,
        conversation_count = excluded.conversation_count,
        first_interacted_at = excluded.first_interacted_at,
        last_interaction_at = excluded.last_interaction_at,
        last_inbound_at = excluded.last_inbound_at,
        last_outbound_at = excluded.last_outbound_at,
        last_conversation_at = excluded.last_conversation_at,
        drift_status = excluded.drift_status,
        engagement_score = excluded.engagement_score,
        updated_at = now()`,
    [personId]
  )
}

export async function ingestActivityBatch(
  client: PoolLike,
  options: {
    userId: string
    connectionId?: string | null
    ownerHandle?: string | null
    ownerId?: string | null
    items: ActivityItemInput[]
    source?: "extension" | "sdk" | "import"
  }
): Promise<IngestionStats> {
  const { userId, connectionId, ownerHandle, ownerId, items, source = "extension" } = options
  const normalizedOwnerHandle = ownerHandle ? normalizeHandle(ownerHandle) : null
  const normalizedOwnerId = ownerId ? String(ownerId) : null

  const personCache = new Map<string, string>()
  const touchedPersonIds = new Set<string>()

  let processedItems = 0
  let newInteractions = 0
  let initialPersonCount = 0

  const countRes = await client.query(
    "select count(*)::int as count from people where user_id = $1",
    [userId]
  )
  initialPersonCount = countRes.rows[0]?.count ?? 0

  for (const item of items) {
    processedItems++
    const actorHandle =
      item.actor?.handle || item.actor_handle || item.actorHandle
    const actorName =
      item.actor?.name || item.actor_name || item.actorName || actorHandle
    const actorId = item.actor?.id
    const normalizedActor = actorHandle ? normalizeHandle(actorHandle) : null

    const isOwner =
      (normalizedOwnerHandle && normalizedActor === normalizedOwnerHandle) ||
      (normalizedOwnerId && actorId && String(actorId) === normalizedOwnerId)

    const personId = isOwner
      ? null
      : await ensurePerson(client, userId, personCache, {
          handle: actorHandle,
          name: actorName,
          id: actorId,
        })

    if (personId) touchedPersonIds.add(personId)

    const actionKind = item.kind || item.type || item.action || "other"
    const body = item.comment_body || item.commentBody || null
    const actionType = classifyAction(actionKind, body)
    const direction = isOwner ? "outbound" : "inbound"
    const occurredAt = parseTimestamp(item.created_at || item.createdAt)

    const externalId =
      String(item.id || item.item_key || item.comment_id || item.commentId || randomUUID())

    const targetType = (item.target_kind || item.targetKind || "post") as "post" | "note"
    const threadKind = targetType === "note" ? "note" : "post"
    const threadRootId =
      item.root_comment_id || item.rootCommentId ? String(item.root_comment_id || item.rootCommentId) : null

    const inserted = await client.query(
      `insert into interactions
          (id, user_id, connection_id, person_id, external_id, source, direction,
           action_type, target_type, target_id, target_title, target_url,
           thread_kind, thread_root_id, body, occurred_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict do nothing
       returning id`,
      [
        randomUUID(),
        userId,
        connectionId ?? null,
        personId,
        externalId,
        source,
        direction,
        actionType,
        targetType,
        threadRootId,
        item.target_title || item.targetTitle || null,
        item.target_url || item.targetUrl || null,
        threadKind,
        threadRootId,
        body,
        occurredAt,
        JSON.stringify(item),
      ]
    )

    if (inserted.rows[0]) newInteractions++
  }

  // Refresh all touched people stats
  for (const pid of touchedPersonIds) {
    await refreshPersonStats(client, pid)
  }

  const finalPersonRes = await client.query(
    "select count(*)::int as count from people where user_id = $1",
    [userId]
  )
  const finalPersonCount = finalPersonRes.rows[0]?.count ?? 0

  return {
    processedItems,
    newInteractions,
    newPeople: Math.max(0, finalPersonCount - initialPersonCount),
    touchedPeople: touchedPersonIds.size,
  }
}

export async function ingestConversationReplies(
  client: PoolLike,
  options: {
    userId: string
    connectionId?: string | null
    ownerHandle?: string | null
    ownerId?: string | null
    conversation: ConversationInput
    source?: "extension" | "sdk" | "import"
  }
): Promise<IngestionStats> {
  const { userId, connectionId, ownerHandle, ownerId, conversation, source = "extension" } = options
  const normalizedOwnerHandle = ownerHandle ? normalizeHandle(ownerHandle) : null
  const normalizedOwnerId = ownerId ? String(ownerId) : null

  const personCache = new Map<string, string>()
  const touchedPersonIds = new Set<string>()

  let processedItems = 0
  let newInteractions = 0

  const countRes = await client.query(
    "select count(*)::int as count from people where user_id = $1",
    [userId]
  )
  const initialPersonCount = countRes.rows[0]?.count ?? 0

  const targetType = conversation.targetType === "post" ? "post" : "note"
  const threadKind = targetType
  const threadRootId = String(conversation.targetId)

  async function traverse(comment: ConversationCommentInput, parentId: string | null) {
    processedItems++
    const rawHandle = comment.author_handle || comment.authorHandle
    const rawName = comment.author_name || comment.authorName || rawHandle
    const rawId = comment.author_id || comment.authorId
    const normalizedActor = rawHandle ? normalizeHandle(rawHandle) : null

    const isOwner =
      (normalizedOwnerHandle && normalizedActor === normalizedOwnerHandle) ||
      (normalizedOwnerId && rawId && String(rawId) === normalizedOwnerId)

    const personId = isOwner
      ? null
      : await ensurePerson(client, userId, personCache, {
          handle: rawHandle,
          name: rawName,
          id: rawId,
        })

    if (personId) touchedPersonIds.add(personId)

    const occurredAt = parseTimestamp(comment.created_at || comment.createdAt)
    const externalId = `comment-${comment.id}`
    const direction = isOwner ? "outbound" : "inbound"

    const inserted = await client.query(
      `insert into interactions
          (id, user_id, connection_id, person_id, external_id, source, direction,
           action_type, target_type, target_id, target_url,
           thread_kind, thread_root_id, body, occurred_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict do nothing
       returning id`,
      [
        randomUUID(),
        userId,
        connectionId ?? null,
        personId,
        externalId,
        source,
        direction,
        parentId ? "reply" : "comment",
        targetType,
        threadRootId,
        conversation.sourceUrl ?? null,
        threadKind,
        threadRootId,
        comment.body ?? null,
        occurredAt,
        JSON.stringify(comment),
      ]
    )

    if (inserted.rows[0]) newInteractions++

    if (Array.isArray(comment.children)) {
      for (const child of comment.children) {
        await traverse(child, String(comment.id))
      }
    }
  }

  for (const comment of conversation.comments) {
    await traverse(comment, null)
  }

  for (const pid of touchedPersonIds) {
    await refreshPersonStats(client, pid)
  }

  const finalPersonRes = await client.query(
    "select count(*)::int as count from people where user_id = $1",
    [userId]
  )
  const finalPersonCount = finalPersonRes.rows[0]?.count ?? 0

  return {
    processedItems,
    newInteractions,
    newPeople: Math.max(0, finalPersonCount - initialPersonCount),
    touchedPeople: touchedPersonIds.size,
  }
}
