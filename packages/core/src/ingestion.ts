import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

export type PoolLike = PoolClient

export interface IngestionStats {
  processedItems: number
  newInteractions: number
  newPeople: number
  touchedPeople: number
}

export interface InteractionAuthorInput {
  id?: string | number | null
  name?: string | null
  handle?: string | null
  photo_url?: string | null
  photoUrl?: string | null
  avatarUrl?: string | null
}

export interface ActivityItemInput {
  id?: string | number
  external_id?: string
  externalId?: string
  item_key?: string
  type?: string
  action?: string
  kind?: string
  created_at?: string | number
  createdAt?: string | number
  updated_at?: string | number
  occurredAt?: string | number
  active?: boolean
  body?: string | null
  comment_body?: string | null
  commentBody?: string | null
  comment_id?: string | number | null
  commentId?: string | number | null
  root_comment_id?: string | number | null
  rootCommentId?: string | number | null
  thread_kind?: "note" | "post" | null
  threadKind?: "note" | "post" | null
  thread_root_id?: string | number | null
  threadRootId?: string | number | null
  target_kind?: string | null
  targetKind?: string | null
  target_id?: string | number | null
  targetId?: string | number | null
  target_title?: string | null
  targetTitle?: string | null
  target_body?: string | null
  targetBody?: string | null
  target_url?: string | null
  targetUrl?: string | null
  actor?: InteractionAuthorInput | null
  target_author?: InteractionAuthorInput | null
  targetAuthor?: InteractionAuthorInput | null
  target?: { author?: InteractionAuthorInput | null; user?: InteractionAuthorInput | null } | null
  actor_name?: string | null
  actorName?: string | null
  actor_handle?: string | null
  actorHandle?: string | null
  actor_photo_url?: string | null
  actorPhotoUrl?: string | null
  actorAvatarUrl?: string | null
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

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function authorFromUnknown(value: unknown): InteractionAuthorInput | null {
  const record = asRecord(value)
  if (!record) return null
  const source = asRecord(record.user) ?? asRecord(record.author) ?? record
  const handle = source.handle ?? source.username ?? source.author_handle
  if (!handle && source.id === undefined && !source.name) return null
  return {
    id: source.id ?? source.user_id ?? null,
    name: source.name ?? source.author_name ?? null,
    handle: handle ?? null,
    photo_url: source.photo_url ?? source.photoUrl ?? source.avatar_url ?? null,
    avatarUrl: source.avatarUrl ?? source.photoUrl ?? source.photo_url ?? null,
  }
}

function targetAuthorFromItem(item: ActivityItemInput): InteractionAuthorInput | null {
  if (item.target_author) return item.target_author
  if (item.targetAuthor) return item.targetAuthor
  const raw = item as Record<string, unknown>
  return (
    authorFromUnknown(item.target?.author) ??
    authorFromUnknown(item.target?.user) ??
    authorFromUnknown(raw.target_comment) ??
    authorFromUnknown(raw.targetComment) ??
    authorFromUnknown(raw.parent_comment) ??
    authorFromUnknown(raw.parentComment) ??
    authorFromUnknown(raw.post) ??
    authorFromUnknown(raw.note)
  )
}

function activityId(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null
}

function indexActivityValues(value: unknown): Map<string, Record<string, any>> {
  const result = new Map<string, Record<string, any>>()
  if (!Array.isArray(value)) return result
  for (const entry of value) {
    const item = asRecord(entry)
    const id = activityId(item?.id)
    if (item && id) result.set(id, item)
  }
  return result
}

function activityBody(value: Record<string, any> | null): string | null {
  if (!value) return null
  for (const candidate of [value.body, value.body_text, value.text]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    const item = asRecord(node)
    if (!item) return
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text)
    visit(item.content)
  }
  visit(value.body_json)
  return parts.join(" ").trim() || null
}

function noteUrl(author: InteractionAuthorInput | null, id: string | null): string | null {
  const handle = author?.handle?.trim().replace(/^@/, "")
  if (!handle || !id) return null
  const noteId = id.startsWith("c-") ? id : `c-${id}`
  return `https://substack.com/@${encodeURIComponent(handle)}/note/${encodeURIComponent(noteId)}`
}

/** Resolves the activity feed's ID references before its lookup arrays are discarded. */
export function normalizeActivityPage(value: unknown): ActivityItemInput[] {
  if (Array.isArray(value)) return value as ActivityItemInput[]
  const page = asRecord(value)
  if (!page || !Array.isArray(page.activityItems)) return []
  const users = indexActivityValues(page.users)
  const comments = indexActivityValues(page.comments)
  const posts = indexActivityValues(page.posts)
  const normalized: ActivityItemInput[] = []

  for (const entry of page.activityItems.slice(0, 500)) {
    const raw = asRecord(entry)
    if (!raw) continue
    const baseId = activityId(raw.id) ?? activityId(raw.item_key)
    if (!baseId) continue
    const commentId = activityId(raw.comment_id)
    const ownComment = commentId ? comments.get(commentId) ?? null : null
    const targetCommentId = activityId(raw.target_comment_id)
    const targetComment = targetCommentId ? comments.get(targetCommentId) ?? null : null
    const postId = activityId(raw.target_post_id)
    const post = postId ? posts.get(postId) ?? null : null
    const ownCommentAuthor = authorFromUnknown(ownComment)
    const targetCommentAuthor = authorFromUnknown(targetComment)
    const postAuthor = authorFromUnknown(post)
    const ancestorPath = typeof ownComment?.ancestor_path === "string"
      ? ownComment.ancestor_path.split(".").filter(Boolean)
      : []
    const rootCommentId = ancestorPath[0] ?? (commentId && targetCommentId ? targetCommentId : null)
    const targetKind = targetComment
      ? typeof targetComment.ancestor_path === "string" && targetComment.ancestor_path.trim() ? "comment" : "note"
      : post ? "post" : raw.target_kind ?? null
    const targetBody = targetComment
      ? activityBody(targetComment)
      : post
        ? activityBody({ body: post.subtitle ?? post.truncated_body_text ?? null })
        : null
    const targetUrl = typeof post?.canonical_url === "string"
      ? post.canonical_url
      : typeof post?.url === "string"
        ? post.url
        : noteUrl(targetCommentAuthor, targetCommentId)
    const kind = String(raw.type ?? raw.kind ?? "activity")
    const senderIds = Array.isArray(raw.recent_sender_ids)
      ? [...new Set(raw.recent_sender_ids.map(activityId).filter((id): id is string => Boolean(id)))]
      : []
    const isSingleAuthorComment = /comment|reply|restack_quote/.test(kind) && Boolean(commentId) && !/like|reaction/.test(kind)
    const actors = isSingleAuthorComment || senderIds.length === 0
      ? [ownCommentAuthor ?? authorFromUnknown(raw.actor)]
      : senderIds.map((id) => authorFromUnknown(users.get(id))).filter((item): item is InteractionAuthorInput => Boolean(item))

    for (const [index, actor] of actors.entries()) {
      normalized.push({
        ...raw,
        externalId: actors.length > 1 ? `${baseId}:sender:${senderIds[index] ?? index}` : baseId,
        kind,
        updated_at: raw.updated_at,
        created_at: raw.created_at ?? raw.updated_at,
        actor,
        commentId,
        commentBody: activityBody(ownComment),
        rootCommentId,
        targetKind,
        targetId: targetCommentId ?? postId ?? rootCommentId,
        targetTitle: typeof post?.title === "string" ? post.title : null,
        targetBody,
        targetUrl,
        targetAuthor: targetCommentAuthor ?? postAuthor,
      })
    }
  }
  return normalized
}

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
  const k = (kind ?? "").toLowerCase()
  if (k.includes("restack")) return "restack"
  if (k.includes("reply")) return "reply"
  if (k.includes("like") || k.includes("heart") || k.includes("reaction")) return "like"
  if (k.includes("subscribe")) return "subscribe"
  if (k.includes("follow")) return "follow"
  if (k.includes("mention")) return "mention"
  if (body && body.trim().length > 0) return "comment"
  return "other"
}

export async function ensurePerson(
  client: PoolLike,
  userId: string,
  personCache: Map<string, string>,
  author: {
    name?: string | null
    handle?: string | null
    id?: string | number | null
    photo_url?: string | null
    avatarUrl?: string | null
  }
): Promise<string | null> {
  const rawHandle = author.handle?.trim()
  const handle = rawHandle ? rawHandle.replace(/^@/, "") : null
  const normalized = handle ? normalizeHandle(handle) : null
  const substackProfileId = author.id === undefined || author.id === null
    ? null
    : String(author.id)
  const avatarUrl = author.photo_url || author.avatarUrl || null
  if (!normalized && !substackProfileId) return null
  const cacheKey = substackProfileId ? `profile:${substackProfileId}` : `handle:${normalized}`

  const cached = personCache.get(cacheKey)
  if (cached) return cached

  const name = author.name?.trim() || handle || `Substack user ${substackProfileId}`
  const profileUrl = normalized ? `https://substack.com/@${encodeURIComponent(normalized)}` : null

  // Stable Substack profile IDs take precedence because reply payloads often
  // omit handles entirely. Handle lookup remains the compatibility fallback.
  // When Substack omits both handle or profile ID across different feeds,
  // exact name + avatar URL (for custom, non-default avatars) merges them safely.
  const found = await client.query(
    `select id, substack_profile_id, handle, normalized_handle, avatar_url from people
     where user_id = $1 and archived_at is null
       and (($2::text is not null and substack_profile_id = $2)
         or ($3::text is not null and normalized_handle = $3)
         or (
           $4::text is not null and length($4) > 1
           and lower(trim(name)) = lower(trim($4))
           and $5::text is not null
           and avatar_url = $5
           and $5 not like '%bbff95e7-e97f-4df2-b99c-d492da3b8601%'
           and $5 not like '%default%'
         ))
     order by case
       when substack_profile_id = $2 then 0
       when normalized_handle = $3 then 1
       else 2
     end
     limit 1`,
    [userId, substackProfileId, normalized, author.name?.trim() || null, avatarUrl]
  )
  if (found.rows[0]) {
    const existing = found.rows[0]
    const id = existing.id as string
    if (substackProfileId && !existing.substack_profile_id) {
      await client.query(
        `update people
         set substack_profile_id = $3, updated_at = now()
         where id = $1 and user_id = $2 and substack_profile_id is null
           and not exists (
             select 1 from people other
             where other.user_id = $2 and other.substack_profile_id = $3
               and other.archived_at is null and other.id <> $1
           )`,
        [id, userId, substackProfileId],
      )
    }
    if (handle && !existing.handle) {
      await client.query(
        `update people
         set handle = $3, normalized_handle = $4,
             profile_url = coalesce(profile_url, $5), updated_at = now()
         where id = $1 and user_id = $2 and handle is null
           and not exists (
             select 1 from people other
             where other.user_id = $2 and other.normalized_handle = $4
               and other.archived_at is null and other.id <> $1
           )`,
        [id, userId, handle, normalized, profileUrl],
      )
    }
    if (avatarUrl && !existing.avatar_url) {
      await client.query(
        `update people
         set avatar_url = $3, updated_at = now()
         where id = $1 and user_id = $2 and (avatar_url is null or avatar_url = '')`,
        [id, userId, avatarUrl]
      )
    }
    personCache.set(cacheKey, id)
    if (substackProfileId) personCache.set(`profile:${substackProfileId}`, id)
    if (normalized) personCache.set(`handle:${normalized}`, id)
    return id
  }

  // Create new person
  const newId = randomUUID()

  await client.query(
    `insert into people (id, user_id, name, handle, normalized_handle, profile_url, substack_profile_id, avatar_url, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'extension')
     on conflict do nothing`,
    [newId, userId, name, handle, normalized, profileUrl, substackProfileId, avatarUrl]
  )

  const check = await client.query(
    `select id from people
     where user_id = $1 and archived_at is null
       and (($2::text is not null and substack_profile_id = $2)
         or ($3::text is not null and normalized_handle = $3)
         or (
           $4::text is not null and length($4) > 1
           and lower(trim(name)) = lower(trim($4))
           and $5::text is not null
           and avatar_url = $5
           and $5 not like '%bbff95e7-e97f-4df2-b99c-d492da3b8601%'
           and $5 not like '%default%'
         ))
     order by case
       when substack_profile_id = $2 then 0
       when normalized_handle = $3 then 1
       else 2
     end
     limit 1`,
    [userId, substackProfileId, normalized, author.name?.trim() || null, avatarUrl]
  )
  const finalId = (check.rows[0]?.id as string) ?? newId
  personCache.set(cacheKey, finalId)
  if (substackProfileId) personCache.set(`profile:${substackProfileId}`, finalId)
  if (normalized) personCache.set(`handle:${normalized}`, finalId)
  return finalId
}

export async function refreshPersonStats(client: PoolLike, personId: string) {
  await client.query(
     `insert into relationship_stats
        (person_id, user_id, interaction_count, conversation_count,
         first_interacted_at, last_interaction_at, last_inbound_at, last_outbound_at,
         last_conversation_at, drift_status, engagement_score,
         inbound_interaction_count, outbound_interaction_count,
         outbound_engagement_score, updated_at)
     select i.person_id, i.user_id, count(*),
        count(distinct i.thread_root_id) filter
          (where i.thread_root_id is not null and i.action_type in ('comment', 'reply')),
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
            when i.direction = 'inbound' and i.action_type = 'like' then 1
            when i.direction = 'inbound' and i.action_type = 'restack' and (i.body is null or trim(i.body) = '') then 2
            when i.direction = 'inbound' and i.action_type = 'restack' then 3
            when i.direction = 'inbound' and i.action_type in ('comment', 'reply') then 3
            when i.direction = 'inbound' then 1
            else 0
          end
        ), 0)::int,
        count(*) filter (where i.direction = 'inbound')::int,
        count(*) filter (where i.direction = 'outbound')::int,
        coalesce(sum(
          case
            when i.direction = 'outbound' and i.action_type = 'like' then 1
            when i.direction = 'outbound' and i.action_type = 'restack' and (i.body is null or trim(i.body) = '') then 2
            when i.direction = 'outbound' and i.action_type = 'restack' then 3
            when i.direction = 'outbound' and i.action_type in ('comment', 'reply') then 3
            when i.direction = 'outbound' then 1
            else 0
          end
        ), 0)::int,
        now()
      from interactions i
      where i.person_id = $1 and i.removed_at is null
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
        inbound_interaction_count = excluded.inbound_interaction_count,
        outbound_interaction_count = excluded.outbound_interaction_count,
        outbound_engagement_score = excluded.outbound_engagement_score,
        updated_at = now()`,
    [personId]
  )
  await client.query(
    `update relationship_stats
     set interaction_count = 0, conversation_count = 0, engagement_score = 0,
         inbound_interaction_count = 0, outbound_interaction_count = 0,
         outbound_engagement_score = 0, first_interacted_at = null,
         last_interaction_at = null, last_inbound_at = null, last_outbound_at = null,
         last_conversation_at = null, drift_status = 'new', updated_at = now()
     where person_id = $1
       and not exists (
         select 1 from interactions where person_id = $1 and removed_at is null
       )`,
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

    const isOwner = item.kind === "outbound-action" ||
      (normalizedOwnerHandle && normalizedActor === normalizedOwnerHandle) ||
      (normalizedOwnerId && actorId && String(actorId) === normalizedOwnerId)

    const targetAuthor = targetAuthorFromItem(item)
    const actorPhoto =
      item.actor?.photo_url ||
      item.actor?.photoUrl ||
      item.actor?.avatarUrl ||
      item.actor_photo_url ||
      item.actorPhotoUrl ||
      item.actorAvatarUrl ||
      null
    const isOwnerAuthor = (author: InteractionAuthorInput | null | undefined) => {
      if (!author) return false
      const normHandle = author.handle ? normalizeHandle(author.handle) : null
      return Boolean(
        (normalizedOwnerHandle && normHandle === normalizedOwnerHandle) ||
        (normalizedOwnerId && author.id && String(author.id) === normalizedOwnerId)
      )
    }

    const counterparty = isOwner
      ? targetAuthor
      : { handle: actorHandle, name: actorName, id: actorId, photo_url: actorPhoto }
    const personId = counterparty && !isOwnerAuthor(counterparty)
      ? await ensurePerson(client, userId, personCache, counterparty)
      : null

    if (personId) touchedPersonIds.add(personId)

    const actionKind = item.kind === "outbound-action"
      ? item.action || "other"
      : item.kind || item.type || item.action || "other"
    const body = item.body || item.comment_body || item.commentBody || null
    const targetBody = item.target_body || item.targetBody || null
    const actionType = classifyAction(actionKind, body)
    const direction = isOwner ? "outbound" : "inbound"
    const occurredAt = parseTimestamp(item.occurredAt || item.created_at || item.createdAt || item.updated_at)

    const externalId =
      String(item.external_id || item.externalId || item.id || item.item_key || item.comment_id || item.commentId || randomUUID())

    const targetType = item.target_kind || item.targetKind || "post"
    const threadKind = item.thread_kind || item.threadKind || (targetType === "note" ? "note" : "post")
    const targetId = item.target_id || item.targetId || item.root_comment_id || item.rootCommentId
    const explicitThreadRootId = item.thread_root_id || item.threadRootId
    const threadRootId = explicitThreadRootId
      ? String(explicitThreadRootId)
      : targetId ? String(targetId) : null

    if (item.active === false) {
      const removed = await client.query(
        `update interactions
         set removed_at = coalesce(removed_at, now()), metadata = $4
         where user_id = $1 and external_id = $2
           and (($3::text is null and connection_id is null) or connection_id = $3)
            or (user_id = $1 and person_id = $5 and direction = $6
              and action_type = $7 and target_type = $8 and target_id = $9
              and action_type in ('like', 'restack') and removed_at is null)
         returning person_id`,
        [
          userId, externalId, connectionId ?? null, JSON.stringify(item),
          personId, direction, actionType, targetType, targetId ? String(targetId) : null,
        ]
      )
      const removedPersonId = removed.rows[0]?.person_id as string | undefined
      if (removedPersonId) touchedPersonIds.add(removedPersonId)
      continue
    }

    // Raw capture evidence remains in ingestion_batches even when Substack does
    // not expose enough identity to attach the action to a CRM person.
    if (!personId) continue

    if (actionType === "subscribe") {
      await client.query(
        `update people
         set is_subscriber = true,
             subscribed_at = coalesce(subscribed_at, $2::timestamptz),
             updated_at = now()
         where id = $1 and user_id = $3`,
        [personId, occurredAt, userId]
      )
    } else if (actionType === "follow") {
      await client.query(
        `update people
         set is_follower = true,
             updated_at = now()
         where id = $1 and user_id = $2`,
        [personId, userId]
      )
    }

    const inserted = await client.query(
      `insert into interactions
          (id, user_id, connection_id, person_id, external_id, source, direction,
           action_type, target_type, target_id, target_title, target_url,
           target_body, thread_kind, thread_root_id, body, occurred_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
        targetId ? String(targetId) : null,
        item.target_title || item.targetTitle || null,
        item.target_url || item.targetUrl || null,
        targetBody,
        threadKind,
        threadRootId,
        body,
        occurredAt,
        JSON.stringify(item),
      ]
    )

    if (inserted.rows[0]) {
      newInteractions++
    } else {
      await client.query(
        `update interactions
         set removed_at = null, person_id = $4, direction = $5,
             action_type = $6,
             target_type = coalesce($7, target_type),
             target_id = coalesce($8, target_id),
             target_title = coalesce(nullif($9, ''), target_title),
             target_url = coalesce(nullif($10, ''), target_url),
             target_body = coalesce(nullif($11, ''), target_body),
             thread_kind = coalesce($12, thread_kind),
             thread_root_id = coalesce($13, thread_root_id),
             body = coalesce(nullif($14, ''), body), occurred_at = $15,
             metadata = metadata || $16::jsonb
         where (user_id = $1 and external_id = $2
           and (($3::text is null and connection_id is null) or connection_id = $3))
           or (user_id = $1 and person_id = $4 and direction = $5
             and action_type = $6 and target_type = $7 and target_id = $8
             and action_type in ('like', 'restack') and removed_at is null)`,
        [
          userId,
          externalId,
          connectionId ?? null,
          personId,
          direction,
          actionType,
          targetType,
          targetId ? String(targetId) : null,
          item.target_title || item.targetTitle || null,
          item.target_url || item.targetUrl || null,
          targetBody,
          threadKind,
          threadRootId,
          body,
          occurredAt,
          JSON.stringify(item),
        ]
      )
    }
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

  const commentAuthor = (comment: ConversationCommentInput | NonNullable<ConversationInput["rootAuthor"]>): InteractionAuthorInput => {
    const raw = comment as Record<string, unknown>
    return {
      id: (raw.author_id ?? raw.authorId ?? raw.id) as string | number | null | undefined,
      name: (raw.author_name ?? raw.authorName ?? raw.name) as string | null | undefined,
      handle: (raw.author_handle ?? raw.authorHandle ?? raw.handle) as string | null | undefined,
      photo_url: (raw.author_photo_url ?? raw.authorPhotoUrl ?? raw.photo_url ?? raw.photoUrl ?? raw.avatar_url ?? raw.avatarUrl) as string | null | undefined,
    }
  }
  const authorIsOwner = (author: InteractionAuthorInput | null): boolean => {
    if (!author) return false
    const normalized = author.handle ? normalizeHandle(author.handle) : null
    return Boolean(
      (normalizedOwnerHandle && normalized === normalizedOwnerHandle) ||
      (normalizedOwnerId && author.id && String(author.id) === normalizedOwnerId)
    )
  }
  const rootAuthor = conversation.rootAuthor ? commentAuthor(conversation.rootAuthor) : null
  const rootIsOwner = authorIsOwner(rootAuthor)

  async function traverse(
    comment: ConversationCommentInput,
    parentId: string | null,
    parentAuthor: InteractionAuthorInput | null,
  ) {
    processedItems++
    const actor = commentAuthor(comment)
    const isOwner = authorIsOwner(actor)
    const directInbound = !isOwner && (
      authorIsOwner(parentAuthor) ||
      (!parentId && (rootIsOwner || rootAuthor === null))
    )
    const counterparty = isOwner ? (parentAuthor ?? rootAuthor) : directInbound ? actor : null
    const personId = counterparty && !authorIsOwner(counterparty)
      ? await ensurePerson(client, userId, personCache, counterparty)
      : null

    if (personId) touchedPersonIds.add(personId)

    const occurredAt = parseTimestamp(comment.created_at || comment.createdAt)
    const externalId = `comment-${comment.id}`
    const direction = isOwner ? "outbound" : "inbound"

    if (personId) {
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
          parentId ?? threadRootId,
          conversation.sourceUrl ?? null,
          threadKind,
          threadRootId,
          comment.body ?? null,
          occurredAt,
          JSON.stringify({ ...comment, directInteraction: true }),
        ]
      )

      if (inserted.rows[0]) newInteractions++
      else {
        await client.query(
          `update interactions
           set person_id = $4, source = $5, direction = $6, action_type = $7,
               target_type = $8, target_id = $9, target_url = $10,
               thread_kind = $11, thread_root_id = $12, body = $13,
               occurred_at = $14, metadata = $15, removed_at = null
           where user_id = $1 and external_id = $2
             and (($3::text is null and connection_id is null) or connection_id = $3)`,
          [
            userId, externalId, connectionId ?? null, personId, source, direction,
            parentId ? "reply" : "comment", targetType, parentId ?? threadRootId,
            conversation.sourceUrl ?? null, threadKind, threadRootId,
            comment.body ?? null, occurredAt,
            JSON.stringify({ ...comment, directInteraction: true }),
          ],
        )
      }
    }

    if (Array.isArray(comment.children)) {
      for (const child of comment.children) {
        await traverse(child, String(comment.id), actor)
      }
    }
  }

  for (const comment of conversation.comments) {
    await traverse(comment, null, null)
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
