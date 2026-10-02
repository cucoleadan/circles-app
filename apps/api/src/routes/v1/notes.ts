import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import {
  attachmentProblem,
  buildNoteBody,
  NOTE_REPLY_ROLES,
  NOTE_SURFACE,
  NOTE_TAB_ID,
  POST_NOW_ABORT_CUTOFF_MS,
  POST_NOW_DELAY_MS,
  triggerAtProblem,
  type DraftNote,
  type NoteReplyMinimumRole,
  type SubstackClient,
} from "@workspace/core"

import {
  applyDraftToRow,
  getNoteByRequest,
  getNoteRow,
  insertPendingNote,
  listNotes,
  NoteRequestError,
  reconcileDrafts,
  requireActiveConnection,
  substackFor,
  toNoteView,
  upstreamError,
  type NoteConnection,
  type ScheduledNoteRow,
} from "../../db/scheduled-notes.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const notesRoutes = new Hono<V1Env>()

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

const mention = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  handle: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(200),
  url: z.string().max(500).nullable().optional(),
  mentionType: z.enum(["user", "pub"]).optional(),
})

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
  markdown: z.string().max(20_000),
  mentions: z.array(mention).max(50).default([]),
  attachments: z.array(attachment).max(6).default([]),
  replyMinimumRole: z.enum(NOTE_REPLY_ROLES).default("everyone"),
  mode: z.enum(["draft", "schedule", "post_now"]),
  triggerAt: z.string().max(40).nullable().optional(),
}

const createInput = z.object({ clientRequestId: z.string().trim().min(8).max(100), ...content })
const updateInput = z.object({
  markdown: content.markdown.optional(),
  mentions: content.mentions,
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

function buildBody(markdown: string, mentions: z.infer<typeof mention>[]) {
  try {
    return buildNoteBody(markdown, mentions)
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

notesRoutes.post("/notes", async (c) => {
  const appUser = c.get("appUser")
  const parsed = createInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid Note" }, 400)
  const input = parsed.data
  try {
    const bodyJson = buildBody(input.markdown, input.mentions)
    const triggerAt = resolveTrigger(input.mode, input.triggerAt)
    checkAttachments(input.attachments.filter((item) => item.type !== "existing"))
    const conn = await requireActiveConnection(appUser)

    // A repeated request ID (double click, retry) never creates a second Note.
    const claim = await withTenant({ appUserId: appUser }, async (client) => {
      const pending = await insertPendingNote(client, {
        appUser,
        connectionId: conn.id,
        clientRequestId: input.clientRequestId,
        bodyText: input.markdown,
        bodyJson,
        replyMinimumRole: input.replyMinimumRole,
        triggerAt,
        postNow: input.mode === "post_now",
      })
      return pending
        ? { pending, existing: null }
        : { pending: null, existing: await getNoteByRequest(client, appUser, input.clientRequestId) }
    })
    if (claim.existing) {
      if (claim.existing.status === "pending") throw new NoteRequestError("This Note is still being saved.", 409)
      return c.json({ note: toNoteView(claim.existing, conn.profileHandle) })
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

    const row = await withTenant({ appUserId: appUser }, (client) =>
      applyDraftToRow(client, pending.id, conn.id, draft, {
        bodyText: input.markdown,
        bodyJson,
        postNow: input.mode === "post_now",
      }),
    )
    return c.json({ note: toNoteView(row, conn.profileHandle) }, 201)
  } catch (error) {
    return fail(c, error)
  }
})

notesRoutes.patch("/notes/:id", async (c) => {
  const appUser = c.get("appUser")
  const parsed = updateInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "Invalid Note" }, 400)
  const input = parsed.data
  try {
    const { row, conn } = await openNote(appUser, c.req.param("id"))
    const bodyJson = input.markdown === undefined ? row.bodyJson : buildBody(input.markdown, input.mentions)
    if (!bodyJson) throw new NoteRequestError("This Note has no content to save.", 400)
    const triggerAt = resolveTrigger(input.mode, input.triggerAt)

    const current = new Set(keptAttachmentIds(row))
    const requested = input.attachments ?? keptAttachmentIds(row).map((id) => ({ type: "existing" as const, id }))
    const kept = requested.flatMap((item) => (item.type === "existing" && current.has(item.id) ? [item.id] : []))
    const added = requested.filter((item) => item.type !== "existing")
    checkAttachments([...kept.map(() => ({ type: "kept" })), ...added])

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

    const updated = await withTenant({ appUserId: appUser }, (client) =>
      applyDraftToRow(client, row.id, conn.id, draft, {
        bodyText: input.markdown ?? row.bodyText,
        bodyJson,
        postNow: input.mode === "post_now",
      }),
    )
    return c.json({ note: toNoteView(updated, conn.profileHandle) })
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
    const updated = await withTenant({ appUserId: appUser }, (client) =>
      applyDraftToRow(client, row.id, conn.id, draft, { bodyText: row.bodyText, bodyJson: row.bodyJson, postNow: false }),
    )
    return c.json({ note: toNoteView(updated, conn.profileHandle) })
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
