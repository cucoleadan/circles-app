import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

import {
  currentConnection,
  getNoteRow,
  NoteRequestError,
  type NoteTag,
  type ScheduledNoteRow,
} from "./scheduled-notes.js"

export { noteTagsFor, type NoteTag } from "./scheduled-notes.js"

export const NOTE_TAG_DEFAULT_COLOR = "#f15a3a"

export interface NoteTagSummary extends NoteTag {
  /** Notes carrying the tag, excluding deleted ones. */
  count: number
  createdAt: string
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string })?.code === "23505"
}

export async function listNoteTags(client: PoolClient): Promise<NoteTagSummary[]> {
  const res = await client.query(
    `select t.id, t.name, t.color, t.created_at as "createdAt",
            count(n.id)::int as count
     from note_tags t
     left join scheduled_note_tags st on st.tag_id = t.id
     left join scheduled_notes n on n.id = st.note_id and n.status <> 'deleted'
     group by t.id
     order by lower(t.name)`,
  )
  return res.rows
}

export async function createNoteTag(
  client: PoolClient,
  appUser: string,
  input: { name: string; color?: string | null },
): Promise<NoteTagSummary> {
  try {
    const res = await client.query(
      `insert into note_tags (id, user_id, name, normalized_name, color)
       values ($1, $2, $3, lower($3), $4)
       returning id, name, color, created_at as "createdAt", 0 as count`,
      [randomUUID(), appUser, input.name, input.color ?? NOTE_TAG_DEFAULT_COLOR],
    )
    return res.rows[0]
  } catch (error) {
    if (isUniqueViolation(error)) throw new NoteRequestError("A tag with that name already exists.", 409)
    throw error
  }
}

export async function updateNoteTag(
  client: PoolClient,
  tagId: string,
  input: { name?: string; color?: string | null },
): Promise<NoteTag | null> {
  try {
    const res = await client.query(
      `update note_tags
       set name = coalesce($2, name), normalized_name = lower(coalesce($2, name)),
           color = coalesce($3, color), updated_at = now()
       where id = $1
       returning id, name, color`,
      [tagId, input.name ?? null, input.color ?? null],
    )
    return res.rows[0] ?? null
  } catch (error) {
    if (isUniqueViolation(error)) throw new NoteRequestError("A tag with that name already exists.", 409)
    throw error
  }
}

/** Deleting a tag only removes it from Notes, never the Notes themselves. */
export async function deleteNoteTag(client: PoolClient, tagId: string): Promise<boolean> {
  const res = await client.query("delete from note_tags where id = $1 returning id", [tagId])
  return Boolean(res.rows[0])
}

/** Attaches existing tags to a Note; unknown IDs are ignored. */
export async function addNoteTags(client: PoolClient, appUser: string, noteId: string, tagIds: string[]) {
  if (tagIds.length === 0) return
  await client.query(
    `insert into scheduled_note_tags (note_id, tag_id, user_id)
     select $1, t.id, $3 from note_tags t where t.id = any($2::text[])
     on conflict (note_id, tag_id) do nothing`,
    [noteId, tagIds, appUser],
  )
}

/**
 * The mirror row to tag. A published Note that only exists in owned_content
 * (listed as `note:<id>`) gets a published mirror row so it can carry tags.
 */
async function taggableNote(client: PoolClient, appUser: string, id: string): Promise<ScheduledNoteRow> {
  if (!id.startsWith("note:")) {
    const row = await getNoteRow(client, id)
    if (!row) throw new NoteRequestError("Note not found.", 404)
    return row
  }
  const conn = await currentConnection(client, appUser)
  if (!conn) throw new NoteRequestError("Note not found.", 404)
  const res = await client.query(
    `insert into scheduled_notes
       (id, user_id, connection_id, substack_draft_id, status, origin, body_text,
        attachments, published_at, last_seen_upstream_at)
     select $1, $2, o.connection_id, o.external_id, 'published', 'substack', coalesce(o.body, ''),
            case when jsonb_typeof(coalesce(o.raw->'comment'->'attachments', o.raw->'attachments')) = 'array'
                 then coalesce(o.raw->'comment'->'attachments', o.raw->'attachments') else '[]'::jsonb end,
            o.published_at, now()
     from owned_content o
     where o.connection_id = $3 and o.kind = 'note' and o.external_id = $4
     on conflict (connection_id, substack_draft_id) do update set updated_at = scheduled_notes.updated_at
     returning id`,
    [randomUUID(), appUser, conn.id, id.slice("note:".length)],
  )
  const row = res.rows[0] ? await getNoteRow(client, res.rows[0].id) : null
  if (!row) throw new NoteRequestError("Note not found.", 404)
  return row
}

/** Replaces a Note's tags and returns the row they now belong to. */
export async function setNoteTags(
  client: PoolClient,
  appUser: string,
  noteId: string,
  tagIds: string[],
): Promise<ScheduledNoteRow> {
  const row = await taggableNote(client, appUser, noteId)
  await client.query(
    "delete from scheduled_note_tags where note_id = $1 and not (tag_id = any($2::text[]))",
    [row.id, tagIds],
  )
  await addNoteTags(client, appUser, row.id, tagIds)
  return row
}
