import { createHash, randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  ingestActivityBatch,
  ingestConversationReplies,
  type ActivityItemInput,
  type ConversationCommentInput,
  type SubstackClient,
} from "@workspace/core"

type HistoryContext = {
  userId: string
  connectionId: string
  ownerId: string | null
  ownerHandle: string | null
  source: "sdk" | "import"
}

export type HistoryPageResult = {
  items: number
  newInteractions: number
  newPeople: number
  nextCursor: string | null
  complete: boolean
}

export type OutboundStage = "likes" | "restacks" | "replies"

type OutboundCursor = {
  stage: OutboundStage
  cursor: string | null
}

const OUTBOUND_STAGES: OutboundStage[] = ["likes", "restacks", "replies"]

const record = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return null
}

const hasHttpStatus = (error: unknown, status: number): boolean => {
  const value = error as { status?: number; statusCode?: number; message?: string }
  return value?.status === status || value?.statusCode === status ||
    String(value?.message ?? "").includes(String(status))
}

function bodyText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (typeof node === "string") return
    if (Array.isArray(node)) return node.forEach(visit)
    const item = record(node)
    if (!item) return
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text)
    visit(item.content)
  }
  visit(value)
  return parts.join(" ").trim() || null
}

function authorOf(raw: Record<string, any>): Record<string, any> {
  const nested = record(raw.user) ?? record(raw.author) ?? record(raw.user_profile)
  if (nested) return nested
  return {
    id: raw.user_id ?? raw.author_id ?? null,
    name: raw.name ?? raw.author_name ?? null,
    handle: raw.handle ?? raw.username ?? raw.author_handle ?? null,
    photo_url: raw.photo_url ?? raw.author_photo_url ?? null,
  }
}

function profileAuthor(raw: Record<string, any> | null): Record<string, any> | null {
  if (!raw) return null
  const author = authorOf(raw)
  const id = firstString(author.id, author.user_id)
  const handle = firstString(author.handle, author.username, author.author_handle)
  if (!id && !handle) return null
  return {
    id,
    name: firstString(author.name, author.author_name),
    handle,
    photo_url: firstString(author.photo_url, author.avatar_url, author.author_photo_url),
  }
}

function isOwner(author: Record<string, any> | null, ownerId: string | null): boolean {
  return Boolean(ownerId && author?.id !== null && author?.id !== undefined && String(author.id) === String(ownerId))
}

function postAuthor(item: Record<string, any>): Record<string, any> | null {
  const post = record(item.post)
  const bylines = Array.isArray(post?.publishedBylines)
    ? post.publishedBylines
    : Array.isArray(item.publishedBylines) ? item.publishedBylines : []
  const byline = bylines.map(record).find(Boolean) ?? null
  if (byline) return profileAuthor({
    user_id: byline.id ?? byline.user_id,
    name: byline.name,
    handle: byline.handle,
    photo_url: byline.photo_url,
  })
  const publication = record(item.publication)
  if (!publication) return null
  return profileAuthor({
    user_id: publication.author_id ?? publication.primary_user_id,
    name: publication.author_name ?? publication.primary_profile_name,
    handle: publication.author_handle,
    photo_url: publication.author_photo_url ?? publication.primary_profile_photo_url,
  })
}

function itemTimestamp(item: Record<string, any>): string | number | null {
  const context = record(item.context)
  const comment = record(item.comment)
  const post = record(item.post)
  return context?.timestamp ?? comment?.date ?? comment?.created_at ?? post?.post_date ?? null
}

function itemUrl(item: Record<string, any>): string | null {
  const context = record(item.context)
  const comment = record(item.comment)
  const post = record(item.post)
  return firstString(context?.fallbackUrl, comment?.canonical_url, comment?.url, post?.canonical_url, post?.url)
}

/** Cover image and publication for a post target; omitted keys keep stored values. */
function postPreview(item: Record<string, any>): { targetImage?: string; targetPublication?: string } {
  const post = record(item.post)
  if (!post) return {}
  const image = firstString(post.cover_image)
  const publication = firstString(record(item.publication)?.name, record(post.publication)?.name)
  return {
    ...(image && { targetImage: image }),
    ...(publication && { targetPublication: publication }),
  }
}

function noteUrl(author: Record<string, any> | null, id: string): string | null {
  const handle = firstString(author?.handle, author?.username)?.replace(/^@/, "")
  if (!handle) return null
  const noteId = id.startsWith("c-") ? id : `c-${id}`
  return `https://substack.com/@${encodeURIComponent(handle)}/note/${encodeURIComponent(noteId)}`
}

function rootCommentId(comment: Record<string, any> | null): string | null {
  if (typeof comment?.ancestor_path !== "string") return null
  return comment.ancestor_path.split(".").map((part: string) => part.trim()).filter(Boolean)[0] ?? null
}

/** Converts raw authenticated profile-feed history into canonical outbound actions. */
export function normalizeOutboundProfileFeed(
  values: unknown[],
  ownerId: string | null,
): ActivityItemInput[] {
  const normalized: ActivityItemInput[] = []

  for (const value of values.slice(0, 500)) {
    const item = record(value)
    if (!item) continue
    const context = record(item.context)
    const contextType = firstString(context?.type)?.toLowerCase() ?? ""
    const contextSource = firstString(context?.source)?.toLowerCase() ?? ""
    const comment = record(item.comment)
    const post = record(item.post)
    const parents = Array.isArray(item.parentComments)
      ? item.parentComments.map(record).filter((parent): parent is Record<string, any> => Boolean(parent))
      : []

    const isLike = contextSource === "db-like" || contextType.endsWith("_like")
    const isRestack = contextSource === "db-restack" || contextType.includes("restack")
    if (isLike || isRestack) {
      const action = isLike ? "like" : "restack"
      const targetKind = contextType === "comment_like"
        ? "comment"
        : contextType === "post_like" || contextType === "post_restack" ? "post" : "note"
      const target = targetKind === "post" ? post : comment
      const targetId = firstString(target?.id, item.id)
      const targetAuthor = targetKind === "post" ? postAuthor(item) : profileAuthor(comment)
      if (!targetId || !targetAuthor || isOwner(targetAuthor, ownerId)) continue
      const postId = firstString(post?.id, comment?.post_id)
      const rootId = postId ?? rootCommentId(comment) ?? targetId
      const targetBody = targetKind === "post"
        ? firstString(post?.subtitle, post?.truncated_body_text)
        : firstString(comment?.body, comment?.body_text) ?? bodyText(comment?.body_json)
      const targetUrl = itemUrl(item) ?? (targetKind !== "post" ? noteUrl(targetAuthor, targetId) : null)

      normalized.push({
        kind: "outbound-action",
        action,
        active: true,
        externalId: `outbound:${action}:${targetKind}:${targetId}`,
        occurredAt: itemTimestamp(item) ?? undefined,
        targetKind,
        targetId,
        targetTitle: firstString(post?.title),
        targetBody,
        targetUrl,
        ...(targetKind === "post" ? postPreview(item) : {}),
        targetAuthor,
        threadKind: postId ? "post" : "note",
        threadRootId: rootId,
      })
      continue
    }

    const author = profileAuthor(comment)
    if (!comment || !author || !isOwner(author, ownerId)) continue
    const targetParent = [...parents]
      .reverse()
      .find((parent) => {
        const parentAuthor = profileAuthor(parent)
        return parentAuthor && !isOwner(parentAuthor, ownerId)
      }) ?? null
    const targetAuthor = targetParent ? profileAuthor(targetParent) : postAuthor(item)
    if (!targetAuthor || isOwner(targetAuthor, ownerId)) continue

    const commentId = firstString(comment.id)
    const postId = firstString(post?.id, comment.post_id)
    const targetId = firstString(targetParent?.id, postId)
    if (!commentId || !targetId) continue
    const hasParent = Boolean(targetParent)

    normalized.push({
      kind: "outbound-action",
      action: hasParent ? "reply" : "comment",
      active: true,
      externalId: `comment-${commentId}`,
      occurredAt: itemTimestamp(item) ?? undefined,
      body: firstString(comment.body, comment.body_text) ?? bodyText(comment.body_json),
      targetKind: hasParent ? "comment" : post ? "post" : "note",
      targetId,
      targetTitle: firstString(post?.title),
      targetUrl: itemUrl(item),
      ...(hasParent ? {} : postPreview(item)),
      targetAuthor,
      threadKind: postId ? "post" : "note",
      threadRootId: postId ?? rootCommentId(comment) ?? targetId,
    })
  }

  return normalized
}

function parseOutboundCursor(value?: string | null): OutboundCursor {
  if (!value) return { stage: "likes", cursor: null }
  try {
    const parsed = JSON.parse(value) as Partial<OutboundCursor>
    if (parsed && OUTBOUND_STAGES.includes(parsed.stage as OutboundStage)) {
      return {
        stage: parsed.stage as OutboundStage,
        cursor: typeof parsed.cursor === "string" && parsed.cursor ? parsed.cursor : null,
      }
    }
  } catch {
    // Pre-SDK checkpoints were never active; restart them safely at likes.
  }
  return { stage: "likes", cursor: null }
}

const encodeOutboundCursor = (cursor: OutboundCursor): string => JSON.stringify(cursor)

async function preserveOutboundEvidence(
  client: PoolClient,
  context: HistoryContext,
  stage: OutboundStage,
  page: unknown,
) {
  const payload = JSON.stringify({ profileFeedStage: stage, page })
  const dedupeKey = createHash("sha256")
    .update(`${context.connectionId}:profile-feed:${stage}:${payload}`)
    .digest("hex")
  await client.query(
    `insert into ingestion_batches
        (id, user_id, source, dedupe_key, payload, status, received_at, processed_at)
     values ($1, $2, $3, $4, $5, 'processed', now(), now())
     on conflict (user_id, dedupe_key) do nothing`,
    [randomUUID(), context.userId, context.source, dedupeKey, payload],
  )
}

async function fetchOutboundPage(
  sdk: SubstackClient,
  ownerId: string,
  stage: OutboundStage,
  cursor: string | null,
  limit: number,
) {
  if (stage === "replies") {
    return sdk.getProfileReplies(ownerId, { cursor: cursor || undefined, limit })
  }
  return sdk.getProfileFeed(ownerId, {
    cursor: cursor || undefined,
    limit,
    types: [stage === "likes" ? "like" : "restack"],
  })
}

function isAtOrBeforeCutoff(item: ActivityItemInput, cutoff?: Date | null): boolean {
  if (!cutoff) return false
  const value = item.occurredAt ?? item.created_at ?? item.createdAt
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date <= cutoff
}

export async function syncOutboundActionsPage(
  client: PoolClient,
  sdk: SubstackClient,
  context: HistoryContext,
  checkpoint?: string | null,
  limit = 20,
  cutoff?: Date | null,
): Promise<HistoryPageResult> {
  if (!context.ownerId) throw new Error("Connected Substack profile has no profile ID")
  const current = parseOutboundCursor(checkpoint)
  const page = await fetchOutboundPage(sdk, context.ownerId, current.stage, current.cursor, limit)
  await preserveOutboundEvidence(client, context, current.stage, page)
  const rawItems = Array.isArray(page?.items) ? page.items : []
  const allItems = normalizeOutboundProfileFeed(rawItems, context.ownerId)
  const hitCutoff = allItems.some((item) => isAtOrBeforeCutoff(item, cutoff))
  const items = cutoff ? allItems.filter((item) => !isAtOrBeforeCutoff(item, cutoff)) : allItems
  const stats = await ingestActivityBatch(client, {
    ...context,
    items,
  })

  const upstreamCursor = firstString(page?.nextCursor)
  let nextCursor: string | null = null
  let complete = false
  if (upstreamCursor && !hitCutoff) {
    nextCursor = encodeOutboundCursor({ stage: current.stage, cursor: upstreamCursor })
  } else {
    const nextStage = OUTBOUND_STAGES[OUTBOUND_STAGES.indexOf(current.stage) + 1]
    if (nextStage) nextCursor = encodeOutboundCursor({ stage: nextStage, cursor: null })
    else complete = true
  }

  return {
    items: rawItems.length,
    newInteractions: stats.newInteractions,
    newPeople: stats.newPeople,
    nextCursor,
    complete,
  }
}

export async function syncRecentOutboundActions(
  client: PoolClient,
  sdk: SubstackClient,
  context: HistoryContext,
  limit = 20,
  stage?: OutboundStage,
  cutoff?: Date | null,
): Promise<HistoryPageResult> {
  if (!context.ownerId) throw new Error("Connected Substack profile has no profile ID")
  let items = 0
  let newInteractions = 0
  let newPeople = 0
  for (const currentStage of stage ? [stage] : OUTBOUND_STAGES) {
    const page = await fetchOutboundPage(sdk, context.ownerId, currentStage, null, limit)
    await preserveOutboundEvidence(client, context, currentStage, page)
    const rawItems = Array.isArray(page?.items) ? page.items : []
    const normalized = normalizeOutboundProfileFeed(rawItems, context.ownerId)
    const filtered = cutoff
      ? normalized.filter((item) => !isAtOrBeforeCutoff(item, cutoff))
      : normalized
    const stats = await ingestActivityBatch(client, {
      ...context,
      items: filtered,
    })
    items += filtered.length
    newInteractions += stats.newInteractions
    newPeople += stats.newPeople
  }
  return { items, newInteractions, newPeople, nextCursor: null, complete: true }
}

function normalizeComment(value: unknown): ConversationCommentInput | null {
  const wrapper = record(value)
  const raw = record(wrapper?.comment) ?? wrapper
  if (!raw) return null
  const id = firstString(raw.id, raw.comment_id)
  if (!id) return null
  const author = authorOf(raw)
  const childrenRaw = raw.children ?? raw.child_comments ?? raw.replies
  const ancestorPath = typeof raw.ancestor_path === "string"
    ? raw.ancestor_path.split(".").map((part: string) => part.trim()).filter(Boolean)
    : []
  return {
    id,
    body: firstString(raw.body, raw.body_text, raw.text) ?? bodyText(raw.body_json),
    createdAt: raw.created_at ?? raw.createdAt ?? raw.date,
    authorId: firstString(raw.user_id, raw.author_id, author.id),
    authorName: firstString(author.name, raw.author_name),
    authorHandle: firstString(author.handle, raw.username, raw.author_handle),
    authorPhotoUrl: firstString(author.photo_url, raw.avatar_url, raw.author_photo_url),
    parentId: firstString(raw.parent_id, raw.parentId, raw.parent_comment_id, ancestorPath.at(-1)),
    children: Array.isArray(childrenRaw)
      ? childrenRaw.map(normalizeComment).filter((item): item is ConversationCommentInput => Boolean(item))
      : [],
  }
}

function buildCommentTree(values: unknown[]): ConversationCommentInput[] {
  const nodes = new Map<string, ConversationCommentInput>()
  const ordered: ConversationCommentInput[] = []
  const add = (value: unknown) => {
    const item = normalizeComment(value)
    if (!item || nodes.has(String(item.id))) return
    const nested = item.children ?? []
    item.children = []
    nodes.set(String(item.id), item)
    ordered.push(item)
    for (const child of nested) add(child)
  }
  for (const value of values) add(value)
  for (const node of ordered) {
    if (!node.parentId) continue
    const parent = nodes.get(String(node.parentId))
    if (parent) {
      parent.children ??= []
      if (!parent.children.some((child) => child.id === node.id)) {
        parent.children.push(node)
      }
    }
  }
  return ordered.filter((node) => !node.parentId || !nodes.has(String(node.parentId)))
}

function noteComments(result: unknown): ConversationCommentInput[] {
  const page = record(result)
  const replies = Array.isArray(page?.replies)
    ? page.replies
    : Array.isArray(page?.comments)
      ? page.comments
      : Array.isArray(page?.items)
        ? page.items
        : []
  return buildCommentTree(replies)
}

export async function replayOwnedNoteSnapshots(
  client: PoolClient,
  context: HistoryContext,
  afterNoteId?: string | null,
  limit = 10,
): Promise<HistoryPageResult> {
  const snapshots = await client.query(
    `select n.note_id, n.payload, o.url
     from note_replies_snapshots n
     left join owned_content o
       on o.connection_id = n.connection_id and o.kind = 'note' and o.external_id = n.note_id
     where n.connection_id = $1 and ($2::text is null or n.note_id > $2)
     order by n.note_id
     limit $3`,
    [context.connectionId, afterNoteId ?? null, limit],
  )
  let newInteractions = 0
  let newPeople = 0
  for (const row of snapshots.rows) {
    const stats = await ingestConversationReplies(client, {
      ...context,
      conversation: {
        targetType: "note",
        targetId: row.note_id,
        sourceUrl: row.url ?? null,
        rootAuthor: { id: context.ownerId, handle: context.ownerHandle },
        comments: noteComments(row.payload),
      },
    })
    newInteractions += stats.newInteractions
    newPeople += stats.newPeople
  }
  const nextCursor = snapshots.rows.at(-1)?.note_id ?? null
  return {
    items: snapshots.rows.length,
    newInteractions,
    newPeople,
    nextCursor,
    complete: snapshots.rows.length < limit,
  }
}

function postComments(result: unknown): ConversationCommentInput[] {
  const page = record(result)
  const comments = Array.isArray(page?.comments)
    ? page.comments
    : Array.isArray(page?.items)
      ? page.items
      : []
  return buildCommentTree(comments)
}

function noteItems(page: unknown): Array<Record<string, any>> {
  const raw = record(page)
  const items = Array.isArray(raw?.items)
    ? raw.items
    : Array.isArray(raw?.notes)
      ? raw.notes
      : Array.isArray(raw?.posts)
        ? raw.posts
        : []
  return items.map((item) => record(item)).filter((item): item is Record<string, any> => Boolean(item))
}

function postItems(page: unknown): Array<Record<string, any>> {
  const raw = record(page)
  const items = Array.isArray(raw?.posts)
    ? raw.posts
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(page)
        ? page
        : []
  return items.map((item) => record(item)).filter((item): item is Record<string, any> => Boolean(item))
}

async function upsertOwnedContent(
  client: PoolClient,
  context: HistoryContext,
  kind: "note" | "post",
  item: Record<string, any>,
): Promise<string | null> {
  const raw = kind === "note" ? record(item.comment) ?? item : item
  const externalId = firstString(raw.id, raw.post_id, item.id)
  if (!externalId) return null
  const title = firstString(raw.title, raw.headline, item.title)
  const body = firstString(raw.body, raw.body_text, raw.subtitle) ?? bodyText(raw.body_json)
  const url = firstString(raw.canonical_url, raw.url, item.canonical_url, item.url)
  const publishedAt = raw.published_at ?? raw.post_date ?? raw.created_at ?? item.created_at ?? null
  await client.query(
    `insert into owned_content
        (id, user_id, connection_id, kind, external_id, title, body, url, published_at, raw, last_synced_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     on conflict (connection_id, kind, external_id) do update
       set title = coalesce(excluded.title, owned_content.title),
           body = coalesce(excluded.body, owned_content.body),
           url = coalesce(excluded.url, owned_content.url),
           published_at = coalesce(excluded.published_at, owned_content.published_at),
           raw = excluded.raw,
           last_synced_at = now(),
           updated_at = now()`,
    [
      randomUUID(), context.userId, context.connectionId, kind, externalId,
      title, body, url, publishedAt, JSON.stringify(item),
    ],
  )
  return externalId
}

export async function syncOwnedNotesPage(
  client: PoolClient,
  sdk: SubstackClient,
  context: HistoryContext,
  cursor?: string | null,
  limit = 20,
  cutoff?: Date | null,
): Promise<HistoryPageResult> {
  if (!context.ownerId) throw new Error("Connected Substack profile has no profile ID")
  const page: any = await sdk.getProfileNotes(context.ownerId, { cursor: cursor || undefined, limit })
  const items = noteItems(page)
  let newInteractions = 0
  let newPeople = 0
  let hitCutoff = false

  for (const item of items) {
    const raw = record(item.comment) ?? item
    const rawDate = raw.published_at ?? raw.created_at ?? item.created_at ?? null
    if (cutoff && rawDate) {
      const d = new Date(rawDate)
      if (!Number.isNaN(d.getTime()) && d <= cutoff) {
        hitCutoff = true
        break
      }
    }

    const noteId = await upsertOwnedContent(client, context, "note", item)
    if (!noteId) continue
    let result: any
    try {
      // Pacing delay between note detail fetches to avoid upstream rate limits
      await new Promise((resolve) => setTimeout(resolve, 300))
      result = await sdk.getNoteWithEngagement(noteId)
    } catch (error) {
      // Deleted or no-longer-readable historical Notes should not poison the
      // entire resumable archive. The owned-content row still records that the
      // profile feed returned the Note, and the cursor may safely advance.
      if (hasHttpStatus(error, 404)) continue
      throw error
    }
    await client.query(
      `insert into note_replies_snapshots (connection_id, note_id, schema_version, payload, captured_at)
       values ($1, $2, 1, $3, now())
       on conflict (connection_id, note_id) do update set payload = excluded.payload, captured_at = now()`,
      [context.connectionId, noteId, JSON.stringify(result)],
    )
    const stats = await ingestConversationReplies(client, {
      ...context,
      conversation: {
        targetType: "note",
        targetId: noteId,
        sourceUrl: firstString(item.canonical_url, item.url, item.comment?.canonical_url),
        rootAuthor: { id: context.ownerId, handle: context.ownerHandle },
        comments: noteComments(result),
      },
    })
    newInteractions += stats.newInteractions
    newPeople += stats.newPeople
  }
  const nextCursor = firstString(page?.nextCursor)
  const complete = hitCutoff || !nextCursor
  return { items: items.length, newInteractions, newPeople, nextCursor: complete ? null : nextCursor, complete }
}

export async function syncOwnedPostsPage(
  client: PoolClient,
  sdk: SubstackClient,
  context: HistoryContext,
  cursor?: string | null,
  limit = 1,
  cutoff?: Date | null,
): Promise<HistoryPageResult> {
  if (!context.ownerId) throw new Error("Connected Substack profile has no profile ID")
  const parsedOffset = cursor ? Number.parseInt(cursor, 10) : 0
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const response = await sdk.getProfilePosts(context.ownerId, { limit, offset })
  const allItems = postItems(response)
  const items = allItems.slice(0, limit)
  let newInteractions = 0
  let newPeople = 0
  let hitCutoff = false

  for (const item of items) {
    const postDate = item.post_date ?? item.published_at ?? item.created_at ?? null
    if (cutoff && postDate) {
      const d = new Date(postDate)
      if (!Number.isNaN(d.getTime()) && d <= cutoff) {
        hitCutoff = true
        break
      }
    }

    const postId = await upsertOwnedContent(client, context, "post", item)
    if (!postId) continue
    let result: any
    try {
      result = await sdk.getPostWithEngagement(postId)
    } catch (error) {
      // Old, deleted, or otherwise unavailable posts can remain in the profile
      // listing after their detail/comments endpoint starts returning 404.
      // Preserve the post seed and advance instead of restarting forever.
      if (hasHttpStatus(error, 404)) continue
      throw error
    }
    await client.query(
      `insert into thread_snapshots
          (id, user_id, connection_id, thread_kind, thread_root_id, complete, payload, fetched_at)
       values ($1, $2, $3, 'post', $4, true, $5, now())
       on conflict (user_id, thread_kind, thread_root_id) do update
         set connection_id = excluded.connection_id, complete = true,
             payload = excluded.payload, fetched_at = now()`,
      [randomUUID(), context.userId, context.connectionId, postId, JSON.stringify(result)],
    )
    const stats = await ingestConversationReplies(client, {
      ...context,
      conversation: {
        targetType: "post",
        targetId: postId,
        sourceUrl: firstString(item.canonical_url, item.url),
        rootAuthor: { id: context.ownerId, handle: context.ownerHandle },
        comments: postComments(result),
      },
    })
    newInteractions += stats.newInteractions
    newPeople += stats.newPeople
  }
  const complete = hitCutoff || items.length < limit
  return {
    items: items.length,
    newInteractions,
    newPeople,
    nextCursor: complete ? null : String(offset + items.length),
    complete,
  }
}
