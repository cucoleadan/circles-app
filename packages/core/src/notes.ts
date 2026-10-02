import {
  markdownToNoteBodyJson,
  noteBodyJsonToMarkdown,
  type DraftNote,
  type NoteAttachment,
  type NotePersonTag,
  type NoteReplyMinimumRole,
  type NoteRichDocument,
} from "unofficial-substack-sdk"

export type { DraftNote, NoteAttachment, NotePersonTag, NoteReplyMinimumRole }

/** Composer context Substack records for Notes created from the CRM. */
export const NOTE_TAB_ID = "for-you"
export const NOTE_SURFACE = "feed"
export const NOTE_MAX_ATTACHMENTS = 6
export const NOTE_REPLY_ROLES = ["everyone", "free_subscriber", "paid_subscriber"] as const
/** Substack rejects later times but still creates a stray unscheduled draft. */
export const NOTE_MAX_SCHEDULE_MS = 92 * 24 * 60 * 60 * 1000
/** Safety margin kept below Substack's 92-day limit. */
const SCHEDULE_HORIZON_MARGIN_MS = 60 * 60 * 1000
/** "Post now" schedules this far ahead so the user can still abort. */
export const POST_NOW_DELAY_MS = 60_000
/** Aborts this close to trigger_at could arrive after Substack publishes. */
export const POST_NOW_ABORT_CUTOFF_MS = 3_000
/** A trigger needs enough lead time to survive the request round trip. */
const MIN_LEAD_MS = 5_000

export type ScheduledNoteStatus = "pending" | "draft" | "scheduled" | "published" | "deleted"

export function mentionToken(tag: NotePersonTag): string {
  return `@${(tag.handle ?? tag.label).replace(/^@/, "")}`
}

/**
 * Builds a Note document from the composer's Markdown. Mentions whose token
 * was edited out of the text are dropped instead of failing the request, and
 * repeated tags collapse to one. Throws SubstackConfigurationError for input
 * Substack cannot store (empty, too long, unsupported syntax).
 */
export function buildNoteBody(markdown: string, mentions: readonly NotePersonTag[] = []): NoteRichDocument {
  const seen = new Set<string>()
  const present = mentions.filter((tag) => {
    const token = mentionToken(tag)
    if (seen.has(token) || !markdown.includes(token)) return false
    seen.add(token)
    return true
  })
  return markdownToNoteBodyJson(markdown, present)
}

/**
 * Returns the composer's Markdown and mentions for a stored Note document, or
 * null when it cannot be edited as Note Markdown without losing content.
 */
export function editableNoteBody(bodyJson: unknown): { markdown: string; mentions: NotePersonTag[] } | null {
  if (!bodyJson) return null
  const editable = noteBodyJsonToMarkdown(bodyJson)
  return editable ? { markdown: editable.markdown, mentions: editable.personTags } : null
}

/** Returns a user-facing problem with a schedule time, or null when valid. */
export function triggerAtProblem(triggerAt: string, now = Date.now()): string | null {
  const at = Date.parse(triggerAt)
  if (!Number.isFinite(at)) return "Choose a valid publish time."
  if (at < now + MIN_LEAD_MS) return "Choose a publish time in the future."
  if (at > now + NOTE_MAX_SCHEDULE_MS - SCHEDULE_HORIZON_MARGIN_MS) {
    return "Substack only schedules Notes up to 92 days ahead."
  }
  return null
}

/** Returns a user-facing problem with an attachment set, or null when valid. */
export function attachmentProblem(attachments: ReadonlyArray<{ type: string }>): string | null {
  if (attachments.length > NOTE_MAX_ATTACHMENTS) {
    return `A Note can have at most ${NOTE_MAX_ATTACHMENTS} attachments.`
  }
  if (attachments.filter((attachment) => attachment.type === "link").length > 1) {
    return "A Note can have only one link attachment."
  }
  return null
}

export function draftStatus(draft: Pick<DraftNote, "trigger_at">): "draft" | "scheduled" {
  return draft.trigger_at ? "scheduled" : "draft"
}

export interface MirroredNote {
  id: string
  substackDraftId: string | null
  status: ScheduledNoteStatus
  triggerAt: Date | string | null
}

export interface VanishedNote {
  id: string
  status: "published" | "deleted"
  publishedAt: string | null
}

/**
 * Decides what happened to mirrored drafts that are no longer in Substack's
 * complete draft list. A published Note keeps its draft ID, so presence in
 * owned_content proves publication; otherwise a passed trigger_at means
 * Substack published it, and anything else was deleted upstream. Deleted rows
 * that later appear in owned_content (posted from Substack's own composer) are
 * corrected to published.
 */
export function planVanishedNotes(input: {
  local: readonly MirroredNote[]
  upstreamDraftIds: ReadonlySet<string>
  publishedAt: ReadonlyMap<string, string | null>
  now?: number
}): VanishedNote[] {
  const now = input.now ?? Date.now()
  const changes: VanishedNote[] = []
  for (const row of input.local) {
    const draftId = row.substackDraftId
    if (!draftId) continue
    const published = input.publishedAt.has(draftId)
    if (row.status === "deleted") {
      if (published) changes.push({ id: row.id, status: "published", publishedAt: input.publishedAt.get(draftId) ?? null })
      continue
    }
    if ((row.status !== "draft" && row.status !== "scheduled") || input.upstreamDraftIds.has(draftId)) continue
    const triggerAt = row.triggerAt ? new Date(row.triggerAt) : null
    if (published) {
      changes.push({
        id: row.id,
        status: "published",
        publishedAt: input.publishedAt.get(draftId) ?? triggerAt?.toISOString() ?? null,
      })
    } else if (row.status === "scheduled" && triggerAt && triggerAt.getTime() <= now) {
      changes.push({ id: row.id, status: "published", publishedAt: triggerAt.toISOString() })
    } else {
      changes.push({ id: row.id, status: "deleted", publishedAt: null })
    }
  }
  return changes
}
