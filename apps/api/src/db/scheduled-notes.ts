import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  createSubstackClient,
  draftStatus,
  isEditableNoteBody,
  noteBodyMentions,
  openSessionToken,
  planVanishedNotes,
  SubstackApiError,
  SubstackConfigurationError,
  type DraftNote,
  type NoteAttachment,
  type ScheduledNoteStatus,
  type SubstackClient,
} from "@workspace/core"

import { withTenant } from "./tenant.js"

/** Mirror refreshes read Substack at most this often per connection. */
const RECONCILE_INTERVAL = "30 seconds"
const FORCED_RECONCILE_INTERVAL = "5 seconds"
/** A create request that never finished; any draft it made is re-imported. */
const STALE_PENDING_INTERVAL = "5 minutes"
const MAX_MIRRORED_DRAFTS = 1000

export interface NoteConnection {
  id: string
  status: string
  publicationUrl: string | null
  profileHandle: string | null
  profileName: string | null
  draftsReconciledAt: string | null
  key_id: string | null
  iv: string | null
  ciphertext: string
}

export interface ScheduledNoteRow {
  id: string
  connectionId: string
  substackDraftId: string | null
  status: ScheduledNoteStatus
  origin: "circles" | "substack"
  bodyText: string
  bodyJson: unknown
  attachments: NoteAttachment[]
  replyMinimumRole: string | null
  triggerAt: string | null
  postNow: boolean
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface NoteTag {
  id: string
  name: string
  color: string
}

export interface ScheduledNoteView {
  id: string
  substackDraftId: string | null
  status: ScheduledNoteStatus
  origin: "circles" | "substack"
  bodyText: string
  /** The stored Note document, loaded into the editor when `editable`. */
  bodyJson: unknown
  mentions: Array<{ id: number; label: string }>
  /** Open, and loadable into the editor without losing content. */
  editable: boolean
  attachments: NoteAttachmentView[]
  replyMinimumRole: string
  triggerAt: string | null
  postNow: boolean
  publishedAt: string | null
  noteUrl: string | null
  tags: NoteTag[]
  createdAt: string
  updatedAt: string
}

const noteColumns = `n.id, n.connection_id as "connectionId", n.substack_draft_id as "substackDraftId",
  n.status, n.origin, n.body_text as "bodyText", n.body_json as "bodyJson", n.attachments,
  n.reply_minimum_role as "replyMinimumRole", n.trigger_at as "triggerAt", n.post_now as "postNow",
  n.published_at as "publishedAt", n.created_at as "createdAt", n.updated_at as "updatedAt"`

/** Raised for problems the user can act on; `status` is the HTTP status to return. */
export class NoteRequestError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409 | 413 | 429 | 502) {
    super(message)
  }
}

export function noteUrl(handle: string | null, draftId: string | null): string | null {
  return handle && draftId ? `https://substack.com/@${handle}/note/c-${draftId}` : null
}

function iso(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

export interface NoteAttachmentView {
  id: string
  type: string
  imageUrl?: string
  linkMetadata?: NoteAttachment["linkMetadata"]
  /** The post a restack-with-Note quotes. */
  post?: {
    url: string | null
    title: string | null
    subtitle: string | null
    coverImage: string | null
    publicationName: string | null
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null)

/** The fields the page renders; a quoted post otherwise ships its whole body. */
function attachmentViews(value: unknown): NoteAttachmentView[] {
  if (!Array.isArray(value)) return []
  return value.map((item: NoteAttachment) => {
    const post = item.type === "post" ? (item.post as Record<string, unknown> | undefined) : undefined
    const publication = item.publication as Record<string, unknown> | undefined
    return {
      id: String(item.id),
      type: item.type,
      imageUrl: item.imageUrl,
      linkMetadata: item.linkMetadata,
      ...(post && {
        post: {
          url: text(post.canonical_url),
          title: text(post.title),
          subtitle: text(post.subtitle),
          coverImage: text(post.cover_image),
          publicationName: text(publication?.name),
        },
      }),
    }
  })
}

export function toNoteView(row: ScheduledNoteRow, handle: string | null, tags: NoteTag[] = []): ScheduledNoteView {
  const open = row.status === "draft" || row.status === "scheduled"
  return {
    id: row.id,
    substackDraftId: row.substackDraftId,
    status: row.status,
    origin: row.origin,
    bodyText: row.bodyText,
    bodyJson: row.bodyJson ?? null,
    mentions: noteBodyMentions(row.bodyJson),
    editable: open && isEditableNoteBody(row.bodyJson),
    attachments: attachmentViews(row.attachments),
    replyMinimumRole: row.replyMinimumRole ?? "everyone",
    triggerAt: iso(row.triggerAt),
    postNow: row.postNow,
    publishedAt: iso(row.publishedAt),
    noteUrl: row.status === "published" ? noteUrl(handle, row.substackDraftId) : null,
    tags,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  }
}

/** Tags per Note ID, sorted by name. */
export async function noteTagsFor(client: PoolClient, noteIds: string[]): Promise<Map<string, NoteTag[]>> {
  const tags = new Map<string, NoteTag[]>()
  if (noteIds.length === 0) return tags
  const res = await client.query(
    `select st.note_id as "noteId", t.id, t.name, t.color
     from scheduled_note_tags st
     join note_tags t on t.id = st.tag_id
     where st.note_id = any($1::text[])
     order by lower(t.name)`,
    [noteIds],
  )
  for (const { noteId, ...tag } of res.rows) {
    tags.set(noteId, [...(tags.get(noteId) ?? []), tag])
  }
  return tags
}

/** One Note's view with its tags. */
export async function noteView(client: PoolClient, row: ScheduledNoteRow, handle: string | null) {
  return toNoteView(row, handle, (await noteTagsFor(client, [row.id])).get(row.id))
}

/** The newest non-revoked connection; mutations additionally require it to be active. */
export async function currentConnection(client: PoolClient, appUser: string): Promise<NoteConnection | null> {
  const res = await client.query(
    `select id, status, publication_url as "publicationUrl", profile_handle as "profileHandle",
            profile_name as "profileName", drafts_reconciled_at as "draftsReconciledAt", key_id, iv, ciphertext
     from substack_connections
     where user_id = $1 and status <> 'revoked'
     order by generation desc limit 1`,
    [appUser],
  )
  return res.rows[0] ?? null
}

export async function requireActiveConnection(appUser: string): Promise<NoteConnection> {
  const conn = await withTenant({ appUserId: appUser }, (client) => currentConnection(client, appUser))
  if (!conn) throw new NoteRequestError("Connect your Substack account first.", 409)
  if (conn.status !== "active") throw new NoteRequestError("Substack session expired", 401)
  return conn
}

export function substackFor(conn: NoteConnection): SubstackClient {
  return createSubstackClient({ sessionToken: openSessionToken(conn), publicationUrl: conn.publicationUrl })
}

/**
 * Translates an SDK failure into a user-facing request error. An upstream 401
 * proves the stored session is dead, so the connection is marked expired the
 * same way the worker does, which shows the reconnect banner.
 */
export async function upstreamError(appUser: string, conn: NoteConnection, error: unknown): Promise<NoteRequestError> {
  if (error instanceof NoteRequestError) return error
  if (error instanceof SubstackConfigurationError) return new NoteRequestError(error.message, 400)
  if (error instanceof SubstackApiError) {
    console.warn(`Substack Note request failed (${error.status}):`, error.upstreamMessage ?? error.message)
    if (error.status === 401) {
      await withTenant({ appUserId: appUser }, async (client) => {
        await client.query(
          "update substack_connections set status = 'expired', updated_at = now() where id = $1 and status = 'active'",
          [conn.id],
        )
        await client.query(
          "update sync_state set status = 'error', error = 'Substack session expired', updated_at = now() where connection_id = $1",
          [conn.id],
        )
      })
      return new NoteRequestError("Substack session expired", 401)
    }
    if (error.status === 429) return new NoteRequestError("Substack is rate limiting requests. Try again in a minute.", 429)
    if (error.status === 413) return new NoteRequestError("That image is too large for Substack.", 413)
    if (error.status === 400) {
      return new NoteRequestError(error.upstreamMessage || "Substack rejected this Note.", 400)
    }
    if (error.status === 403) return new NoteRequestError("Substack rejected this request. Refresh and try again.", 409)
    return new NoteRequestError("Substack is unavailable right now. Try again shortly.", 502)
  }
  console.error("Note request failed:", (error as Error)?.message ?? error)
  return new NoteRequestError("Substack is unavailable right now. Try again shortly.", 502)
}

export async function getNoteRow(client: PoolClient, id: string): Promise<ScheduledNoteRow | null> {
  const res = await client.query(`select ${noteColumns} from scheduled_notes n where n.id = $1`, [id])
  return res.rows[0] ?? null
}

export async function getNoteByRequest(client: PoolClient, appUser: string, clientRequestId: string) {
  const res = await client.query(
    `select ${noteColumns} from scheduled_notes n where n.user_id = $1 and n.client_request_id = $2`,
    [appUser, clientRequestId],
  )
  return (res.rows[0] as ScheduledNoteRow | undefined) ?? null
}

export async function insertPendingNote(
  client: PoolClient,
  input: {
    appUser: string
    connectionId: string
    clientRequestId: string
    bodyText: string
    bodyJson: unknown
    replyMinimumRole: string
    triggerAt: string | null
    postNow: boolean
  },
): Promise<ScheduledNoteRow | null> {
  // Returns null when this client request ID was already used.
  const res = await client.query(
    `insert into scheduled_notes
       (id, user_id, connection_id, status, origin, body_text, body_json,
        reply_minimum_role, trigger_at, post_now, client_request_id)
     values ($1, $2, $3, 'pending', 'circles', $4, $5, $6, $7, $8, $9)
     on conflict (user_id, client_request_id) do nothing
     returning ${noteColumns.replaceAll("n.", "")}`,
    [
      randomUUID(), input.appUser, input.connectionId, input.bodyText, JSON.stringify(input.bodyJson),
      input.replyMinimumRole, input.triggerAt, input.postNow, input.clientRequestId,
    ],
  )
  return res.rows[0] ?? null
}

/**
 * Stores the draft Substack returned for a row. A concurrent mirror refresh
 * may already have imported the same draft as a Substack-origin row; that
 * duplicate is removed so the Circles row keeps its history and flags.
 */
export async function applyDraftToRow(
  client: PoolClient,
  rowId: string,
  connectionId: string,
  draft: DraftNote,
  fallback: { bodyText: string; bodyJson: unknown; postNow: boolean },
): Promise<ScheduledNoteRow> {
  const draftId = String(draft.id)
  // Tags added to the duplicate while both existed move to the kept row.
  await client.query(
    `insert into scheduled_note_tags (note_id, tag_id, user_id)
     select $3, st.tag_id, st.user_id
     from scheduled_note_tags st
     join scheduled_notes dup on dup.id = st.note_id
     where dup.connection_id = $1 and dup.substack_draft_id = $2 and dup.id <> $3
     on conflict (note_id, tag_id) do nothing`,
    [connectionId, draftId, rowId],
  )
  await client.query(
    "delete from scheduled_notes where connection_id = $1 and substack_draft_id = $2 and id <> $3",
    [connectionId, draftId, rowId],
  )
  const res = await client.query(
    `update scheduled_notes
     set substack_draft_id = $2, status = $3, body_text = $4, body_json = $5,
         attachments = $6, reply_minimum_role = $7, trigger_at = $8, post_now = $9,
         published_at = null, raw = $10, last_seen_upstream_at = now(), updated_at = now()
     where id = $1
     returning ${noteColumns.replaceAll("n.", "")}`,
    [
      rowId, draftId, draftStatus(draft), draft.body ?? fallback.bodyText,
      JSON.stringify(draft.body_json ?? fallback.bodyJson), JSON.stringify(draft.attachments ?? []),
      draft.reply_minimum_role ?? "everyone", draft.trigger_at ?? null,
      fallback.postNow && Boolean(draft.trigger_at), JSON.stringify(draft),
    ],
  )
  return res.rows[0]
}

/**
 * Refreshes the mirror from Substack's complete draft list. Throttled per
 * connection; `force` (the Refresh button) uses a shorter interval. Returns
 * false when the refresh was skipped.
 */
export async function reconcileDrafts(appUser: string, options: { force?: boolean } = {}): Promise<boolean> {
  const conn = await withTenant({ appUserId: appUser }, async (client) => {
    const current = await currentConnection(client, appUser)
    if (!current || current.status !== "active") return null
    const claimed = await client.query(
      `update substack_connections set drafts_reconciled_at = now()
       where id = $1 and (drafts_reconciled_at is null or drafts_reconciled_at < now() - $2::interval)
       returning id`,
      [current.id, options.force ? FORCED_RECONCILE_INTERVAL : RECONCILE_INTERVAL],
    )
    return claimed.rows[0] ? current : null
  })
  if (!conn) return false

  let drafts: DraftNote[]
  try {
    drafts = await substackFor(conn).getAllDraftNotes({ maxItems: MAX_MIRRORED_DRAFTS })
  } catch (error) {
    throw await upstreamError(appUser, conn, error)
  }

  await withTenant({ appUserId: appUser }, async (client) => {
    for (const draft of drafts) {
      await client.query(
        `insert into scheduled_notes
           (id, user_id, connection_id, substack_draft_id, status, origin, body_text, body_json,
            attachments, reply_minimum_role, trigger_at, raw, last_seen_upstream_at)
         values ($1, $2, $3, $4, $5, 'substack', $6, $7, $8, $9, $10, $11, now())
         on conflict (connection_id, substack_draft_id) do update
           set status = excluded.status,
               body_text = excluded.body_text,
               body_json = excluded.body_json,
               attachments = excluded.attachments,
               reply_minimum_role = excluded.reply_minimum_role,
               post_now = scheduled_notes.post_now
                 and excluded.trigger_at is not distinct from scheduled_notes.trigger_at,
               trigger_at = excluded.trigger_at,
               published_at = null,
               raw = excluded.raw,
               last_seen_upstream_at = now(),
               updated_at = case
                 when (scheduled_notes.status, scheduled_notes.trigger_at, scheduled_notes.body_json)
                   is distinct from (excluded.status, excluded.trigger_at, excluded.body_json)
                 then now() else scheduled_notes.updated_at end`,
        [
          randomUUID(), appUser, conn.id, String(draft.id), draftStatus(draft), draft.body ?? "",
          JSON.stringify(draft.body_json ?? null), JSON.stringify(draft.attachments ?? []),
          draft.reply_minimum_role ?? "everyone", draft.trigger_at ?? null, JSON.stringify(draft),
        ],
      )
    }

    await client.query(
      `delete from scheduled_notes
       where connection_id = $1 and status = 'pending' and created_at < now() - $2::interval`,
      [conn.id, STALE_PENDING_INTERVAL],
    )

    // Absence only proves something when the list was complete.
    if (drafts.length >= MAX_MIRRORED_DRAFTS) return
    const local = await client.query(
      `select id, substack_draft_id as "substackDraftId", status, trigger_at as "triggerAt"
       from scheduled_notes
       where connection_id = $1
         and (status in ('draft', 'scheduled')
              or (status = 'deleted' and updated_at > now() - interval '14 days'))`,
      [conn.id],
    )
    const ids = local.rows.map((row) => row.substackDraftId).filter(Boolean)
    const owned = ids.length
      ? await client.query(
          `select external_id, published_at from owned_content
           where connection_id = $1 and kind = 'note' and external_id = any($2::text[])`,
          [conn.id, ids],
        )
      : { rows: [] }
    const changes = planVanishedNotes({
      local: local.rows,
      upstreamDraftIds: new Set(drafts.map((draft) => String(draft.id))),
      publishedAt: new Map(owned.rows.map((row) => [row.external_id as string, iso(row.published_at)])),
    })
    for (const change of changes) {
      await client.query(
        `update scheduled_notes
         set status = $2, published_at = $3, post_now = false, updated_at = now()
         where id = $1`,
        [change.id, change.status, change.publishedAt],
      )
    }
  })
  return true
}

/**
 * Open drafts and scheduled Notes, plus Notes published in the window: those
 * scheduled through the mirror and any other authored Note already synced
 * into owned_content.
 */
export async function listNotes(appUser: string, range: { from: string; to: string }) {
  return withTenant({ appUserId: appUser }, async (client) => {
    const conn = await currentConnection(client, appUser)
    if (!conn) return { connection: null, notes: [] as ScheduledNoteView[] }
    const rows = await client.query(
      `select ${noteColumns} from scheduled_notes n
       where n.connection_id = $1
         and (n.status in ('pending', 'draft', 'scheduled')
              or (n.status = 'published'
                  and coalesce(n.published_at, n.trigger_at, n.updated_at) between $2 and $3))
       order by n.trigger_at nulls last, n.updated_at desc`,
      [conn.id, range.from, range.to],
    )
    const owned = await client.query(
      `select o.external_id, o.body, o.url, o.published_at, o.created_at, o.updated_at,
              coalesce(o.raw->'comment'->'attachments', o.raw->'attachments') as attachments
       from owned_content o
       where o.connection_id = $1 and o.kind = 'note'
         and o.published_at between $2 and $3
         and not exists (
           select 1 from scheduled_notes n
           where n.connection_id = o.connection_id and n.substack_draft_id = o.external_id
         )
       order by o.published_at desc
       limit 500`,
      [conn.id, range.from, range.to],
    )
    const tags = await noteTagsFor(client, rows.rows.map((row) => row.id))
    const notes = rows.rows.map((row) => toNoteView(row, conn.profileHandle, tags.get(row.id)))
    for (const row of owned.rows) {
      notes.push({
        id: `note:${row.external_id}`,
        substackDraftId: row.external_id,
        status: "published",
        origin: "substack",
        bodyText: row.body ?? "",
        bodyJson: null,
        mentions: [],
        editable: false,
        attachments: attachmentViews(row.attachments),
        replyMinimumRole: "everyone",
        triggerAt: null,
        postNow: false,
        publishedAt: iso(row.published_at),
        noteUrl: row.url ?? noteUrl(conn.profileHandle, row.external_id),
        tags: [],
        createdAt: iso(row.created_at)!,
        updatedAt: iso(row.updated_at)!,
      })
    }
    return {
      connection: {
        id: conn.id,
        status: conn.status,
        profileHandle: conn.profileHandle,
        profileName: conn.profileName,
        draftsReconciledAt: iso(conn.draftsReconciledAt),
      },
      notes,
    }
  })
}
