import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import {
  attachmentProblem,
  noteBodyText,
  NOTE_REPLY_ROLES,
  NOTE_SURFACE,
  NOTE_TAB_ID,
  POST_NOW_ABORT_CUTOFF_MS,
  POST_NOW_DELAY_MS,
  prepareNoteBody,
  triggerAtProblem,
  type DraftNote,
  type NoteReplyMinimumRole,
  type SubstackClient,
} from "@workspace/core"

import {
  applyDraftToRow,
  currentConnection,
  getNoteByRequest,
  getNoteRow,
  insertPendingNote,
  listNotes,
  noteView,
  NoteRequestError,
  reconcileDrafts,
  requireActiveConnection,
  substackFor,
  upstreamError,
  type NoteConnection,
  type ScheduledNoteRow,
} from "../../db/scheduled-notes.js"
import {
  addNoteTags,
  createNoteTag,
  deleteNoteTag,
  listNoteTags,
  setNoteTags,
  updateNoteTag,
} from "../../db/note-tags.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const notesRoutes = new Hono<V1Env>()

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
/** Generous for a 5,000-character Note document; rejects runaway payloads. */
const MAX_NOTE_REQUEST_BYTES = 512 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

const httpsUrl = z.string().trim().max(2000).url().refine((value) => /^https?:\/\//i.test(value), "Use an http(s) link")

const attachment = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    image: z.object({
      id: z.number(),
      url: httpsUrl,
      contentType: z.string().max(100),
      bytes: z.number(),
      imageWidth: z.number(),
      imageHeight: z.number(),
    }),
  }),
  z.object({ type: z.literal("link"), url: httpsUrl }),
  // An attachment the draft already has, kept by its upstream ID.
  z.object({ type: z.literal("existing"), id: z.string().min(1).max(100) }),
])

const content = {
  // The editor's ProseMirror document; normalized and validated by prepareNoteBody.
  bodyJson: z.record(z.string(), z.unknown()),
  attachments: z.array(attachment).max(6).default([]),
  replyMinimumRole: z.enum(NOTE_REPLY_ROLES).default("everyone"),
  mode: z.enum(["draft", "schedule", "post_now"]),
  triggerAt: z.string().max(40).nullable().optional(),
}

const tagIds = z.array(z.string().min(1).max(100)).max(20)

const createInput = z.object({
  clientRequestId: z.string().trim().min(8).max(100),
  ...content,
  tagIds: tagIds.default([]),
})
const updateInput = z.object({
  bodyJson: content.bodyJson.optional(),
  attachments: z.array(attachment).max(6).optional(),
  replyMinimumRole: z.enum(NOTE_REPLY_ROLES).optional(),
  mode: content.mode,
  triggerAt: content.triggerAt,
})

type AttachmentInput = z.infer<typeof attachment>

function fail(c: Context<V1Env>, error: unknown) {
  if (error instanceof NoteRequestError) return c.json({ error: error.message }, error.status)
  throw error
}

function buildBody(bodyJson: unknown, hasAttachments: boolean) {
  try {
    return prepareNoteBody(bodyJson, { hasAttachments })
  } catch (error) {
    throw new NoteRequestError((error as Error).message || "This Note cannot be saved.", 400)
  }
}

/** Resolves the publish time for a mode; drafts have none. */
function resolveTrigger(mode: "draft" | "schedule" | "post_now", triggerAt: string | null | undefined): string | null {
  if (mode === "draft") return null
  if (mode === "post_now") return new Date(Date.now() + POST_NOW_DELAY_MS).toISOString()
  if (!triggerAt) throw new NoteRequestError("Choose a publish time.", 400)
  const problem = triggerAtProblem(triggerAt)
  if (problem) throw new NoteRequestError(problem, 400)
  return new Date(triggerAt).toISOString()
}

function checkAttachments(attachments: ReadonlyArray<AttachmentInput | { type: string }>) {
  const problem = attachmentProblem(attachments.map((item) => ({ type: item.type === "existing" ? "kept" : item.type })))
  if (problem) throw new NoteRequestError(problem, 400)
}

/** Creates new attachments just before use; Substack may expire unused IDs. */
async function attachmentIds(sdk: SubstackClient, attachments: AttachmentInput[], kept: string[]) {
  const ids = [...kept]
  for (const item of attachments) {
    if (item.type === "image") ids.push((await sdk.createImageAttachment(item.image)).id)
    else if (item.type === "link") ids.push((await sdk.createAttachment({ url: item.url, type: "link" })).id)
  }
  return ids
}

function writeDraft(
  sdk: SubstackClient,
  draftId: string | null,
  request: { bodyJson: unknown; replyMinimumRole: NoteReplyMinimumRole; attachmentIds: string[]; triggerAt: string | null },
): Promise<DraftNote> {
  const { triggerAt, ...rest } = request
  if (draftId === null) {
    return triggerAt
      ? sdk.scheduleNote({ ...rest, tabId: NOTE_TAB_ID, surface: NOTE_SURFACE, triggerAt })
      : sdk.createDraftNote({ ...rest, tabId: NOTE_TAB_ID, surface: NOTE_SURFACE })
  }
  return triggerAt
    ? sdk.updateScheduledNote(draftId, { ...rest, triggerAt })
    : sdk.unscheduleNote(draftId, rest)
}

/** Loads an open draft or scheduled Note that can still be changed upstream. */
async function openNote(appUser: string, id: string): Promise<{ row: ScheduledNoteRow; conn: NoteConnection }> {
  const row = await withTenant({ appUserId: appUser }, (client) => getNoteRow(client, id))
  if (!row) throw new NoteRequestError("Note not found.", 404)
  if (row.status === "pending") throw new NoteRequestError("This Note is still being saved.", 409)
  if (row.status !== "draft" && row.status !== "scheduled") {
    throw new NoteRequestError("This Note can no longer be changed.", 409)
  }
  const conn = await requireActiveConnection(appUser)
  if (row.connectionId !== conn.id) {
    throw new NoteRequestError("This Note belongs to a previous Substack connection.", 409)
  }
  if (row.status === "scheduled" && row.triggerAt) {
    const remaining = new Date(row.triggerAt).getTime() - Date.now()
    if (remaining <= POST_NOW_ABORT_CUTOFF_MS) {
      throw new NoteRequestError("Substack is publishing this Note now. Refresh in a moment.", 409)
    }
  }
  return { row, conn }
}

function keptAttachmentIds(row: ScheduledNoteRow): string[] {
  return (Array.isArray(row.attachments) ? row.attachments : []).map((item) => String(item.id))
}

function range(c: Context<V1Env>) {
  const now = Date.now()
  const from = Date.parse(c.req.query("from") ?? "")
  const to = Date.parse(c.req.query("to") ?? "")
  return {
    from: new Date(Number.isFinite(from) ? from : now - 31 * DAY_MS).toISOString(),
    to: new Date(Number.isFinite(to) ? to : now + 93 * DAY_MS).toISOString(),
  }
}

notesRoutes.get("/notes", async (c) => {
  return c.json(await listNotes(c.get("appUser"), range(c)))
})

notesRoutes.post("/notes/refresh", async (c) => {
  const appUser = c.get("appUser")
  try {
    const refreshed = await reconcileDrafts(appUser, { force: c.req.query("force") === "1" })
    return c.json({ refreshed, ...(await listNotes(appUser, range(c))) })
  } catch (error) {
    return fail(c, error)
  }
})

const noteBodyLimit = bodyLimit({
  maxSize: MAX_NOTE_REQUEST_BYTES,
  onError: (c) => c.json({ error: "This Note is too large." }, 413),
})

notesRoutes.post("/notes", noteBodyLimit, async (c) => {
  const appUser = c.get("appUser")
  const parsed = createInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid Note" }, 400)
  const input = parsed.data
  try {
    const bodyJson = buildBody(input.bodyJson, input.attachments.length > 0)
    const triggerAt = resolveTrigger(input.mode, input.triggerAt)
    checkAttachments(input.attachments.filter((item) => item.type !== "existing"))
    const conn = await requireActiveConnection(appUser)

    // A repeated request ID (double click, retry) never creates a second Note.
    const claim = await withTenant({ appUserId: appUser }, async (client) => {
      const pending = await insertPendingNote(client, {
        appUser,
        connectionId: conn.id,
        clientRequestId: input.clientRequestId,
        bodyText: noteBodyText(bodyJson),
        bodyJson,
        replyMinimumRole: input.replyMinimumRole,
        triggerAt,
        postNow: input.mode === "post_now",
      })
      if (pending) await addNoteTags(client, appUser, pending.id, input.tagIds)
      return pending
        ? { pending, existing: null }
        : { pending: null, existing: await getNoteByRequest(client, appUser, input.clientRequestId) }
    })
    if (claim.existing) {
      if (claim.existing.status === "pending") throw new NoteRequestError("This Note is still being saved.", 409)
      const existing = claim.existing
      return c.json({
        note: await withTenant({ appUserId: appUser }, (client) => noteView(client, existing, conn.profileHandle)),
      })
    }
    const pending = claim.pending!

    let draft: DraftNote
    try {
      const sdk = substackFor(conn)
      draft = await writeDraft(sdk, null, {
        bodyJson,
        replyMinimumRole: input.replyMinimumRole,
        attachmentIds: await attachmentIds(sdk, input.attachments, []),
        triggerAt,
      })
    } catch (error) {
      await withTenant({ appUserId: appUser }, (client) =>
        client.query("delete from scheduled_notes where id = $1 and status = 'pending'", [pending.id]),
      )
      throw await upstreamError(appUser, conn, error)
    }

    const note = await withTenant({ appUserId: appUser }, async (client) => {
      const row = await applyDraftToRow(client, pending.id, conn.id, draft, {
        bodyText: noteBodyText(bodyJson),
        bodyJson,
        postNow: input.mode === "post_now",
      })
      return noteView(client, row, conn.profileHandle)
    })
    return c.json({ note }, 201)
  } catch (error) {
    return fail(c, error)
  }
})

notesRoutes.patch("/notes/:id", noteBodyLimit, async (c) => {
  const appUser = c.get("appUser")
  const parsed = updateInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid Note" }, 400)
  const input = parsed.data
  try {
    const { row, conn } = await openNote(appUser, c.req.param("id"))
    const triggerAt = resolveTrigger(input.mode, input.triggerAt)

    const current = new Set(keptAttachmentIds(row))
    const requested = input.attachments ?? keptAttachmentIds(row).map((id) => ({ type: "existing" as const, id }))
    const kept = requested.flatMap((item) => (item.type === "existing" && current.has(item.id) ? [item.id] : []))
    const added = requested.filter((item) => item.type !== "existing")
    checkAttachments([...kept.map(() => ({ type: "kept" })), ...added])

    const bodyJson = input.bodyJson === undefined ? row.bodyJson : buildBody(input.bodyJson, kept.length + added.length > 0)
    if (!bodyJson) throw new NoteRequestError("This Note has no content to save.", 400)

    let draft: DraftNote
    try {
      const sdk = substackFor(conn)
      draft = await writeDraft(sdk, row.substackDraftId, {
        bodyJson,
        replyMinimumRole: (input.replyMinimumRole ?? row.replyMinimumRole ?? "everyone") as NoteReplyMinimumRole,
        attachmentIds: await attachmentIds(sdk, added, kept),
        triggerAt,
      })
    } catch (error) {
      throw await upstreamError(appUser, conn, error)
    }

    const note = await withTenant({ appUserId: appUser }, async (client) => {
      const updated = await applyDraftToRow(client, row.id, conn.id, draft, {
        bodyText: input.bodyJson === undefined ? row.bodyText : noteBodyText(bodyJson),
        bodyJson,
        postNow: input.mode === "post_now",
      })
      return noteView(client, updated, conn.profileHandle)
    })
    return c.json({ note })
  } catch (error) {
    return fail(c, error)
  }
})

/** Stops a pending "Post now" and keeps the Note as an unscheduled draft. */
notesRoutes.post("/notes/:id/abort", async (c) => {
  const appUser = c.get("appUser")
  try {
    const { row, conn } = await openNote(appUser, c.req.param("id"))
    if (row.status !== "scheduled" || !row.postNow) {
      throw new NoteRequestError("This Note is not waiting to post.", 409)
    }
    let draft: DraftNote
    try {
      draft = await substackFor(conn).unscheduleNote(row.substackDraftId!, {
        bodyJson: row.bodyJson,
        replyMinimumRole: (row.replyMinimumRole ?? "everyone") as NoteReplyMinimumRole,
        attachmentIds: keptAttachmentIds(row),
      })
    } catch (error) {
      throw await upstreamError(appUser, conn, error)
    }
    const note = await withTenant({ appUserId: appUser }, async (client) => {
      const updated = await applyDraftToRow(client, row.id, conn.id, draft, {
        bodyText: row.bodyText,
        bodyJson: row.bodyJson,
        postNow: false,
      })
      return noteView(client, updated, conn.profileHandle)
    })
    return c.json({ note })
  } catch (error) {
    return fail(c, error)
  }
})

notesRoutes.delete("/notes/:id", async (c) => {
  const appUser = c.get("appUser")
  try {
    const { row, conn } = await openNote(appUser, c.req.param("id"))
    try {
      await substackFor(conn).deleteNote(row.substackDraftId!)
    } catch (error) {
      throw await upstreamError(appUser, conn, error)
    }
    await withTenant({ appUserId: appUser }, (client) =>
      client.query(
        "update scheduled_notes set status = 'deleted', post_now = false, updated_at = now() where id = $1",
        [row.id],
      ),
    )
    return c.body(null, 204)
  } catch (error) {
    return fail(c, error)
  }
})

// Tags are Circles-only labels; changing them never calls Substack.

const tagInput = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
})

notesRoutes.get("/notes/tags", async (c) => {
  const tags = await withTenant({ appUserId: c.get("appUser") }, listNoteTags)
  return c.json({ tags })
})

notesRoutes.post("/notes/tags", async (c) => {
  const appUser = c.get("appUser")
  const parsed = tagInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Give the tag a name up to 60 characters." }, 400)
  try {
    const tag = await withTenant({ appUserId: appUser }, (client) => createNoteTag(client, appUser, parsed.data))
    return c.json({ tag }, 201)
  } catch (error) {
    return fail(c, error)
  }
})

notesRoutes.patch("/notes/tags/:tagId", async (c) => {
  const parsed = tagInput.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Give the tag a name up to 60 characters." }, 400)
  try {
    const tag = await withTenant({ appUserId: c.get("appUser") }, (client) =>
      updateNoteTag(client, c.req.param("tagId"), parsed.data),
    )
    if (!tag) return c.json({ error: "Tag not found." }, 404)
    return c.json({ tag })
  } catch (error) {
    return fail(c, error)
  }
})

notesRoutes.delete("/notes/tags/:tagId", async (c) => {
  const deleted = await withTenant({ appUserId: c.get("appUser") }, (client) =>
    deleteNoteTag(client, c.req.param("tagId")),
  )
  if (!deleted) return c.json({ error: "Tag not found." }, 404)
  return c.body(null, 204)
})

/** Replaces a Note's tags. Works for any Note, including published ones. */
notesRoutes.put("/notes/:id/tags", async (c) => {
  const appUser = c.get("appUser")
  const parsed = z.object({ tagIds }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid tags" }, 400)
  try {
    const note = await withTenant({ appUserId: appUser }, async (client) => {
      const row = await setNoteTags(client, appUser, c.req.param("id"), parsed.data.tagIds)
      const conn = await currentConnection(client, appUser)
      return noteView(client, row, conn?.profileHandle ?? null)
    })
    return c.json({ note })
  } catch (error) {
    return fail(c, error)
  }
})

/** Identifies the image formats the composer accepts from their leading bytes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg"
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif"
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp"
  return null
}

notesRoutes.post(
  "/notes/images",
  bodyLimit({
    maxSize: MAX_IMAGE_BYTES + 64 * 1024,
    onError: (c) => c.json({ error: "Images must be 15 MB or smaller." }, 413),
  }),
  async (c) => {
    const appUser = c.get("appUser")
    try {
      const body = await c.req.parseBody()
      const file = body.file
      if (!(file instanceof File)) throw new NoteRequestError("Choose an image to upload.", 400)
      if (file.size > MAX_IMAGE_BYTES) throw new NoteRequestError("Images must be 15 MB or smaller.", 413)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const contentType = sniffImageType(bytes)
      if (!contentType) throw new NoteRequestError("Use a PNG, JPEG, GIF, or WebP image.", 400)
      const conn = await requireActiveConnection(appUser)
      try {
        const image = await substackFor(conn).uploadImage(bytes, { contentType })
        return c.json({ image })
      } catch (error) {
        throw await upstreamError(appUser, conn, error)
      }
    } catch (error) {
      return fail(c, error)
    }
  },
)
