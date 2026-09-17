import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  ingestConversationReplies,
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
  return record(raw.user) ?? record(raw.author) ?? record(raw.user_profile) ?? {}
}

function normalizeComment(value: unknown): ConversationCommentInput | null {
  const wrapper = record(value)
  const raw = record(wrapper?.comment) ?? wrapper
  if (!raw) return null
  const id = firstString(raw.id, raw.comment_id)
  if (!id) return null
  const author = authorOf(raw)
  const childrenRaw = raw.children ?? raw.child_comments ?? raw.replies
  return {
    id,
    body: firstString(raw.body, raw.body_text, raw.text) ?? bodyText(raw.body_json),
    createdAt: raw.created_at ?? raw.createdAt ?? raw.date,
    authorId: firstString(author.id, raw.user_id, raw.author_id),
    authorName: firstString(author.name, raw.author_name),
    authorHandle: firstString(author.handle, author.username, raw.author_handle),
    authorPhotoUrl: firstString(author.photo_url, author.avatar_url, raw.author_photo_url),
    parentId: firstString(raw.parent_id, raw.parentId, raw.parent_comment_id),
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
    nested.forEach(add)
  }
  values.forEach(add)

  const roots: ConversationCommentInput[] = []
  for (const item of ordered) {
    const parentId = item.parentId === null || item.parentId === undefined ? null : String(item.parentId)
    const parent = parentId ? nodes.get(parentId) : null
    if (parent) (parent.children ??= []).push(item)
    else roots.push(item)
  }
  return roots
}

function noteComments(result: any): ConversationCommentInput[] {
  const values: unknown[] = []
  for (const page of Array.isArray(result?.replyPages) ? result.replyPages : []) {
    for (const branch of Array.isArray(page?.commentBranches) ? page.commentBranches : []) {
      values.push(branch)
      if (Array.isArray(branch?.descendantComments)) values.push(...branch.descendantComments)
    }
  }
  return buildCommentTree(values)
}

function postComments(result: any): ConversationCommentInput[] {
  const values = Array.isArray(result?.comments)
    ? result.comments
    : Array.isArray(result?.commentItems)
    ? result.commentItems
    : []
  return buildCommentTree(values)
}

function noteItems(page: any): Record<string, any>[] {
  return Array.isArray(page?.items)
    ? page.items.map(record).filter((item: Record<string, any> | null): item is Record<string, any> => Boolean(item))
    : []
}

function postItems(response: any): Record<string, any>[] {
  const values = Array.isArray(response)
    ? response
    : Array.isArray(response?.posts)
    ? response.posts
    : Array.isArray(response?.items)
    ? response.items
    : []
  return values.map(record).filter((item: Record<string, any> | null): item is Record<string, any> => Boolean(item))
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
): Promise<HistoryPageResult> {
  if (!context.ownerId) throw new Error("Connected Substack profile has no profile ID")
  const page: any = await sdk.getProfileNotes(context.ownerId, { cursor: cursor || undefined, limit })
  const items = noteItems(page)
  let newInteractions = 0
  let newPeople = 0
  for (const item of items) {
    const noteId = await upsertOwnedContent(client, context, "note", item)
    if (!noteId) continue
    const result: any = await sdk.getNoteWithEngagement(noteId)
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
  return { items: items.length, newInteractions, newPeople, nextCursor, complete: !nextCursor }
}

export async function syncOwnedPosts(
  client: PoolClient,
  sdk: SubstackClient,
  context: HistoryContext,
  limit?: number,
): Promise<HistoryPageResult> {
  if (!context.ownerId) throw new Error("Connected Substack profile has no profile ID")
  const response = await sdk.getProfilePosts(context.ownerId)
  const allItems = postItems(response)
  const items = typeof limit === "number" ? allItems.slice(0, limit) : allItems
  let newInteractions = 0
  let newPeople = 0
  for (const item of items) {
    const postId = await upsertOwnedContent(client, context, "post", item)
    if (!postId) continue
    const result: any = await sdk.getPostWithEngagement(postId)
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
  return {
    items: items.length,
    newInteractions,
    newPeople,
    nextCursor: null,
    complete: limit === undefined || items.length === allItems.length,
  }
}
