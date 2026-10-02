export type NoteStatus = "pending" | "draft" | "scheduled" | "published" | "deleted"
export type NoteReplyRole = "everyone" | "free_subscriber" | "paid_subscriber"
export type NoteMode = "post_now" | "schedule" | "draft"

export interface NoteMention {
  id: number
  label: string
}

export interface NoteAttachment {
  id: string
  type: string
  imageUrl?: string
  linkMetadata?: { url?: string; host?: string; title?: string }
}

export interface UploadedImage {
  id: number
  url: string
  contentType: string
  bytes: number
  imageWidth: number
  imageHeight: number
}

export interface NoteTag {
  id: string
  name: string
  color: string
}

export interface NoteTagSummary extends NoteTag {
  /** Notes carrying the tag, excluding deleted ones. */
  count: number
  createdAt: string
}

export interface ScheduledNote {
  id: string
  substackDraftId: string | null
  status: NoteStatus
  origin: "circles" | "substack"
  bodyText: string
  /** Stored Substack Note document; loaded into the editor when `editable`. */
  bodyJson: unknown
  mentions: NoteMention[]
  editable: boolean
  attachments: NoteAttachment[]
  replyMinimumRole: NoteReplyRole
  triggerAt: string | null
  postNow: boolean
  publishedAt: string | null
  noteUrl: string | null
  tags: NoteTag[]
  createdAt: string
  updatedAt: string
}

export interface NotesConnection {
  id: string
  status: string
  profileHandle: string | null
  profileName: string | null
  draftsReconciledAt: string | null
}

export interface NotesResponse {
  connection: NotesConnection | null
  notes: ScheduledNote[]
  refreshed?: boolean
}

/** Mirrors the API's abort cutoff: later aborts could race Substack's publish. */
export const POST_NOW_ABORT_CUTOFF_MS = 3_000
export const NOTE_TEXT_LIMIT = 5000
export const NOTE_MAX_ATTACHMENTS = 6
export const MAX_SCHEDULE_DAYS = 92

export const replyRoleLabels: Record<NoteReplyRole, string> = {
  everyone: "Everyone",
  free_subscriber: "Subscribers",
  paid_subscriber: "Paid subscribers",
}

export class NotesApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function notesApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, init)
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}))
  if (!res.ok) throw new NotesApiError(body.error || `Request failed (${res.status})`, res.status)
  return body as T
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/** The moment a Note appears on the calendar: when it publishes or published. */
export function noteMoment(note: ScheduledNote): Date | null {
  const value = note.status === "published" ? note.publishedAt ?? note.triggerAt : note.triggerAt
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

export function formatWhen(date: Date): string {
  return `${formatDay(date)}, ${formatTime(date)}`
}

export function timeZoneLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = -new Date().getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const hours = Math.floor(Math.abs(offset) / 60)
  const minutes = Math.abs(offset) % 60
  return `${zone} (UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""})`
}

/** First non-empty line of a Note, for compact previews. */
export function noteTitle(note: Pick<ScheduledNote, "bodyText">): string {
  return note.bodyText.split(/\n+/).find((line) => line.trim())?.trim() || "(Attachment only)"
}

export const statusLabels: Record<NoteStatus, string> = {
  pending: "Saving",
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  deleted: "Deleted",
}

export const statusClasses: Record<NoteStatus, string> = {
  pending: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
  draft: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  scheduled: "bg-orange-50 text-[#c2410c] border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900",
  published: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  deleted: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function errorStatus(error: unknown): number | null {
  return error instanceof NotesApiError ? error.status : null
}
