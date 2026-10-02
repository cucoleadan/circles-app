import {
  normalizeNoteBodyJson,
  SubstackConfigurationError,
  type DraftNote,
  type NoteAttachment,
  type NoteReplyMinimumRole,
  type NoteRichDocument,
} from "unofficial-substack-sdk"

export type { DraftNote, NoteAttachment, NoteReplyMinimumRole }

/** Composer context Substack records for Notes created from the CRM. */
export const NOTE_TAB_ID = "for-you"
export const NOTE_SURFACE = "feed"
export const NOTE_MAX_ATTACHMENTS = 6
export const NOTE_TEXT_LIMIT = 5000
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

type DocNode = { type?: unknown; text?: unknown; attrs?: Record<string, unknown>; content?: unknown }

function children(node: DocNode): DocNode[] {
  return Array.isArray(node.content) ? (node.content as DocNode[]) : []
}

/**
 * Plain text of a Note document: one line per paragraph, list items prefixed,
 * and mentions written as `@Label`. Used for previews, search, and the
 * 5,000-character limit, which applies to visible text.
 */
export function noteBodyText(bodyJson: unknown): string {
  const lines: string[] = []
  const inline = (node: DocNode): string =>
    node.type === "text"
      ? String(node.text ?? "")
      : node.type === "substack_mention"
        ? `@${String(node.attrs?.label ?? "")}`
        : children(node).map(inline).join("")
  const block = (node: DocNode, prefix = "") => {
    if (node.type === "bulletList" || node.type === "orderedList") {
      children(node).forEach((item, index) => {
        const marker = node.type === "orderedList" ? `${Number(node.attrs?.start ?? 1) + index}. ` : "- "
        children(item).forEach((child, childIndex) => block(child, childIndex === 0 ? prefix + marker : prefix + "  "))
      })
    } else if (node.type === "blockquote") {
      children(node).forEach((child) => block(child, prefix + "> "))
    } else if (node.type === "paragraph" || node.type === "codeBlock") {
      lines.push(prefix + inline(node))
    } else {
      children(node).forEach((child) => block(child, prefix))
    }
  }
  if (bodyJson && typeof bodyJson === "object") block(bodyJson as DocNode)
  return lines.join("\n")
}

/** People and publications mentioned in a Note document, in order. */
export function noteBodyMentions(bodyJson: unknown): Array<{ id: number; label: string }> {
  const found = new Map<number, string>()
  const walk = (node: DocNode) => {
    if (node.type === "substack_mention" && typeof node.attrs?.id === "number") {
      found.set(node.attrs.id, String(node.attrs.label ?? ""))
    }
    children(node).forEach(walk)
  }
  if (bodyJson && typeof bodyJson === "object") walk(bodyJson as DocNode)
  return [...found].map(([id, label]) => ({ id, label }))
}

/**
 * Normalizes an editor document into the form Substack stores unchanged.
 * Throws SubstackConfigurationError for formatting Substack Notes do not
 * support, an empty Note without attachments, or text over the limit.
 */
export function prepareNoteBody(bodyJson: unknown, options: { hasAttachments?: boolean } = {}): NoteRichDocument {
  const doc = normalizeNoteBodyJson(bodyJson)
  const text = noteBodyText(doc)
  if (!text.trim() && !options.hasAttachments) {
    throw new SubstackConfigurationError("Write something or add an attachment first.")
  }
  if (text.length > NOTE_TEXT_LIMIT) {
    throw new SubstackConfigurationError(`Notes can be at most ${NOTE_TEXT_LIMIT.toLocaleString("en-US")} characters.`)
  }
  return doc
}

/** Whether a stored Note document can be loaded into the editor without losing content. */
export function isEditableNoteBody(bodyJson: unknown): boolean {
  if (!bodyJson) return false
  try {
    normalizeNoteBodyJson(bodyJson)
    return true
  } catch {
    return false
  }
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
