import { useRef, useState } from "react"
import type { JSONContent } from "@tiptap/core"
import type { Editor } from "@tiptap/react"
import {
  AtSign,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Clock3,
  FileText,
  ImagePlus,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  dayKey,
  errorMessage,
  formatWhen,
  jsonInit,
  MAX_SCHEDULE_DAYS,
  NOTE_MAX_ATTACHMENTS,
  NOTE_TEXT_LIMIT,
  noteTitle,
  notesApi,
  replyRoleLabels,
  timeZoneLabel,
  type NoteAttachment,
  type NoteMode,
  type NoteReplyRole,
  type ScheduledNote,
  type UploadedImage,
} from "../../lib/notes"
import { NoteEditor, toSubstackDoc } from "./note-editor"

const DAY_MS = 24 * 60 * 60 * 1000
const CARD_CLASS =
  "rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
const ACCEPTED_IMAGES = "image/png,image/jpeg,image/gif,image/webp"

function atTime(day: Date, time: string): Date {
  const [hours = 9, minutes = 0] = time.split(":").map(Number)
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes
  )
}

function timeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function quickSlots(now = new Date()) {
  const inHour = new Date(now.getTime() + 60 * 60 * 1000)
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 15) * 15, 0, 0)
  return [
    { label: "In 1 hour", at: inHour },
    {
      label: "Tomorrow 9:00",
      at: atTime(new Date(now.getTime() + DAY_MS), "09:00"),
    },
  ]
}

/** The existing time for a scheduled Note, a picked calendar day, or tomorrow 9:00. */
function defaultSchedule(note: ScheduledNote | null, day: Date | null): Date {
  if (note?.status === "scheduled" && note.triggerAt)
    return new Date(note.triggerAt)
  if (day) return atTime(day, "09:00")
  return atTime(new Date(Date.now() + DAY_MS), "09:00")
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "Me"
  )
}

const iconButtonClass =
  "flex size-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:pointer-events-none disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white"

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={iconButtonClass}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function NoteComposer({
  note = null,
  seed = null,
  initialDate = null,
  connectionReady,
  profileName,
  drafts = [],
  onPickDraft,
  onSaved,
  onCancel,
  framed = false,
}: {
  note?: ScheduledNote | null
  /** Prefilled content for a new Note, such as a duplicate. */
  seed?: { bodyJson: JSONContent } | null
  initialDate?: Date | null
  connectionReady: boolean
  profileName: string | null
  drafts?: ScheduledNote[]
  onPickDraft?: (note: ScheduledNote) => void
  onSaved: (note: ScheduledNote, mode: NoteMode) => void
  onCancel?: () => void
  /** Render the composer and schedule as separate cards (the page) rather than one panel (the dialog). */
  framed?: boolean
}) {
  const isEdit = Boolean(note)
  const canEditText = !note || note.editable
  const editorRef = useRef<Editor | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(crypto.randomUUID())

  const [textLength, setTextLength] = useState(0)
  const [isEmpty, setIsEmpty] = useState(!note && !seed)
  const [kept, setKept] = useState<NoteAttachment[]>(note?.attachments ?? [])
  const [images, setImages] = useState<UploadedImage[]>([])
  const [link, setLink] = useState("")
  const [linkDraft, setLinkDraft] = useState("")
  const [linkOpen, setLinkOpen] = useState(false)
  const [replyRole, setReplyRole] = useState<NoteReplyRole>(
    note?.replyMinimumRole ?? "everyone"
  )
  const initialSchedule = defaultSchedule(note, initialDate)
  const [pickDay, setPickDay] = useState<Date>(startOfDay(initialSchedule))
  const [pickTime, setPickTime] = useState(timeOf(initialSchedule))
  const [dayOpen, setDayOpen] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkTrimmed = link.trim()
  const hasKeptLink = kept.some((item) => item.type === "link")
  const attachmentCount = kept.length + images.length + (linkTrimmed ? 1 : 0)
  const hasContent = !isEmpty || attachmentCount > 0 || (isEdit && !canEditText)
  const overLimit = textLength > NOTE_TEXT_LIMIT
  const scheduleAt = atTime(pickDay, pickTime)
  const imagePreviews = [
    ...kept
      .filter((item) => item.imageUrl)
      .map((item) => ({
        key: item.id,
        url: item.imageUrl!,
        remove: () =>
          setKept((prev) => prev.filter((other) => other.id !== item.id)),
      })),
    ...images.map((image) => ({
      key: `new-${image.id}`,
      url: image.url,
      remove: () =>
        setImages((prev) => prev.filter((other) => other.id !== image.id)),
    })),
  ]
  const linkPreviews = [
    ...kept
      .filter((item) => item.type === "link")
      .map((item) => ({
        key: item.id,
        url: item.linkMetadata?.url || item.linkMetadata?.title || "Link",
        remove: () =>
          setKept((prev) => prev.filter((other) => other.id !== item.id)),
      })),
    ...(linkTrimmed
      ? [{ key: "new-link", url: linkTrimmed, remove: () => setLink("") }]
      : []),
  ]

  function syncEditorState(editor: Editor) {
    editorRef.current = editor
    setTextLength(editor.storage.characterCount.characters())
    setIsEmpty(editor.isEmpty)
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const room = NOTE_MAX_ATTACHMENTS - attachmentCount
    const picked = Array.from(files).slice(0, Math.max(0, room))
    if (picked.length < files.length)
      setError(`A Note can have at most ${NOTE_MAX_ATTACHMENTS} attachments.`)
    for (const file of picked) {
      if (file.size > 15 * 1024 * 1024) {
        setError(`${file.name} is larger than 15 MB.`)
        continue
      }
      setUploading((count) => count + 1)
      try {
        const form = new FormData()
        form.append("file", file)
        const { image } = await notesApi<{ image: UploadedImage }>(
          "/notes/images",
          { method: "POST", body: form }
        )
        setImages((prev) => [...prev, image])
      } catch (err) {
        setError(errorMessage(err, "Could not upload the image."))
      } finally {
        setUploading((count) => count - 1)
      }
    }
    if (fileRef.current) fileRef.current.value = ""
  }

  function insertMention() {
    const editor = editorRef.current
    if (!editor) return
    const { from } = editor.state.selection
    const before = editor.state.doc.textBetween(Math.max(0, from - 1), from)
    editor
      .chain()
      .focus()
      .insertContent(before && !/\s/.test(before) ? " @" : "@")
      .run()
  }

  function clearComposer() {
    editorRef.current?.commands.clearContent(true)
    setImages([])
    setLink("")
    const next = defaultSchedule(null, null)
    setPickDay(startOfDay(next))
    setPickTime(timeOf(next))
    setError(null)
  }

  function validate(mode: NoteMode): string | null {
    if (!connectionReady) return "Connect your Substack account first."
    if (!hasContent) return "Write something or add an attachment first."
    if (overLimit)
      return `Notes can be at most ${NOTE_TEXT_LIMIT.toLocaleString()} characters.`
    if (attachmentCount > NOTE_MAX_ATTACHMENTS)
      return `A Note can have at most ${NOTE_MAX_ATTACHMENTS} attachments.`
    if (mode === "schedule") {
      if (scheduleAt.getTime() < Date.now() + 60_000)
        return "Pick a time at least a minute from now."
      if (
        scheduleAt.getTime() >
        Date.now() + MAX_SCHEDULE_DAYS * DAY_MS - 60 * 60 * 1000
      ) {
        return `Substack schedules Notes up to ${MAX_SCHEDULE_DAYS} days ahead.`
      }
    }
    return null
  }

  async function submit(mode: NoteMode) {
    const problem = validate(mode)
    setError(problem)
    if (problem) return
    setSubmitting(true)
    const attachments = [
      ...kept.map((item) => ({ type: "existing" as const, id: item.id })),
      ...images.map((image) => ({ type: "image" as const, image })),
      ...(linkTrimmed ? [{ type: "link" as const, url: linkTrimmed }] : []),
    ]
    const editor = editorRef.current
    const content = {
      ...(canEditText && editor
        ? { bodyJson: toSubstackDoc(editor.getJSON()) }
        : {}),
      replyMinimumRole: replyRole,
      mode,
      triggerAt: mode === "schedule" ? scheduleAt.toISOString() : null,
    }
    try {
      const { note: saved } = isEdit
        ? await notesApi<{ note: ScheduledNote }>(
            `/notes/${note!.id}`,
            jsonInit("PATCH", { ...content, attachments })
          )
        : await notesApi<{ note: ScheduledNote }>(
            "/notes",
            jsonInit("POST", {
              clientRequestId: requestId.current,
              ...content,
              attachments: attachments.filter(
                (item) => item.type !== "existing"
              ),
            })
          )
      requestId.current = crypto.randomUUID()
      if (!isEdit) clearComposer()
      onSaved(saved, mode)
    } catch (err) {
      setError(errorMessage(err, "Could not save the Note."))
    } finally {
      setSubmitting(false)
    }
  }

  // Ctrl/Cmd+Enter keeps a scheduled Note scheduled; otherwise it posts.
  const shortcutMode: NoteMode =
    note?.status === "scheduled" ? "schedule" : "post_now"
  const today = startOfDay(new Date())
  const lastDay = new Date(Date.now() + (MAX_SCHEDULE_DAYS - 1) * DAY_MS)
  const displayName = profileName || "You"

  return (
    <div className="space-y-3">
      <div className={framed ? CARD_CLASS : ""}>
        {/* Author and drafts */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="size-9">
              <AvatarFallback className="bg-[#f15a3a] text-xs font-bold text-white">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
              {displayName}
            </span>
          </div>
          {!isEdit && onPickDraft && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs font-semibold"
                >
                  Drafts
                  {drafts.length > 0 && (
                    <span className="font-normal text-muted-foreground">
                      {drafts.length}
                    </span>
                  )}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-xs">
                  Unscheduled drafts
                </DropdownMenuLabel>
                {drafts.length === 0 ? (
                  <p className="px-2 pb-2 text-xs text-muted-foreground">
                    No drafts yet. Save one from the ⋯ menu.
                  </p>
                ) : (
                  drafts.slice(0, 12).map((draft) => (
                    <DropdownMenuItem
                      key={draft.id}
                      onSelect={() => onPickDraft(draft)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="w-full truncate text-xs font-medium">
                        {noteTitle(draft)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Edited {formatWhen(new Date(draft.updatedAt))}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Body */}
        <div className="mt-3 sm:pl-[46px]">
          {canEditText ? (
            <NoteEditor
              initialContent={
                (note?.bodyJson as JSONContent | null) ?? seed?.bodyJson ?? null
              }
              autofocus={isEdit}
              onReady={syncEditorState}
              onUpdate={syncEditorState}
              onSubmitShortcut={() => void submit(shortcutMode)}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-stone-700 dark:text-stone-300">
                {note?.bodyText}
              </p>
              <p className="text-[11px] text-muted-foreground">
                This Note uses formatting the editor can't load, so only its
                time and audience can change here.
              </p>
            </div>
          )}

          {(imagePreviews.length > 0 ||
            linkPreviews.length > 0 ||
            uploading > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {imagePreviews.map((item) => (
                <div
                  key={item.key}
                  className="relative size-24 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800"
                >
                  <img
                    src={item.url}
                    alt=""
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={item.remove}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {uploading > 0 && (
                <div className="flex size-24 items-center justify-center rounded-xl border border-dashed border-stone-300 dark:border-stone-700">
                  <LoaderCircle className="size-4 animate-spin text-stone-400" />
                </div>
              )}
              {linkPreviews.map((item) => (
                <div
                  key={item.key}
                  className="flex h-10 max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 pr-1 pl-3 text-xs dark:border-stone-800 dark:bg-stone-900"
                >
                  <Link2 className="size-3.5 shrink-0 text-stone-400" />
                  <span className="truncate">{item.url}</span>
                  <button
                    type="button"
                    aria-label="Remove link"
                    onClick={item.remove}
                    className="rounded-full p-1 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 text-xs font-medium text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        {/* Toolbar */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          <div className="flex items-center">
            <IconButton
              label="Add image"
              disabled={
                attachmentCount >= NOTE_MAX_ATTACHMENTS || !connectionReady
              }
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="size-[18px]" />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGES}
              multiple
              className="hidden"
              onChange={(event) => void uploadFiles(event.target.files)}
            />

            <Popover
              open={linkOpen}
              onOpenChange={(open) => {
                setLinkOpen(open)
                if (open) setLinkDraft(link)
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Attach a link"
                  title="Attach a link"
                  disabled={
                    hasKeptLink || attachmentCount >= NOTE_MAX_ATTACHMENTS
                  }
                  className={iconButtonClass}
                >
                  <Link2 className="size-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-2 p-3">
                <p className="text-xs font-semibold">Attach a link</p>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const value = linkDraft.trim()
                    if (value && !/^https?:\/\/\S+$/i.test(value)) {
                      setError("Links must start with http:// or https://.")
                      return
                    }
                    setLink(value)
                    setLinkOpen(false)
                  }}
                >
                  <Input
                    autoFocus
                    value={linkDraft}
                    onChange={(event) => setLinkDraft(event.target.value)}
                    placeholder="https://"
                    className="h-8 text-xs"
                  />
                  <Button type="submit" size="sm" className="h-8">
                    Add
                  </Button>
                </form>
                <p className="text-[11px] text-muted-foreground">
                  Substack shows a preview card for the link.
                </p>
              </PopoverContent>
            </Popover>

            {canEditText && (
              <IconButton label="Mention someone" onClick={insertMention}>
                <AtSign className="size-[18px]" />
              </IconButton>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  title="More options"
                  className={iconButtonClass}
                >
                  <MoreHorizontal className="size-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem
                  disabled={submitting || !hasContent}
                  onSelect={() => void submit("draft")}
                >
                  <FileText />{" "}
                  {note?.status === "scheduled"
                    ? "Move to drafts"
                    : "Save as draft"}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <AtSign /> Who can reply
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={replyRole}
                      onValueChange={(value) =>
                        setReplyRole(value as NoteReplyRole)
                      }
                    >
                      {Object.entries(replyRoleLabels).map(([value, label]) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {!isEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={clearComposer}
                    >
                      <X /> Clear
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2">
            {textLength > NOTE_TEXT_LIMIT - 500 && (
              <span
                className={`text-[11px] tabular-nums ${overLimit ? "font-semibold text-destructive" : "text-muted-foreground"}`}
              >
                {(NOTE_TEXT_LIMIT - textLength).toLocaleString()}
              </span>
            )}
            {replyRole !== "everyone" && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {replyRoleLabels[replyRole]} can reply
              </span>
            )}
            {(onCancel || hasContent) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3"
                disabled={submitting}
                onClick={() => (onCancel ? onCancel() : clearComposer())}
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => void submit("post_now")}
              disabled={
                submitting ||
                uploading > 0 ||
                !connectionReady ||
                !hasContent ||
                overLimit
              }
              title="Posts in 1 minute; you can abort until then"
              className="h-8 rounded-full bg-[#f15a3a] px-4 font-semibold text-white hover:bg-[#d94a2c]"
            >
              {submitting && <LoaderCircle className="animate-spin" />}
              Post
            </Button>
          </div>
        </div>
      </div>

      {/* Schedule */}
      <section
        aria-label="Schedule"
        className={
          framed
            ? `${CARD_CLASS} space-y-3`
            : "space-y-3 border-t border-stone-100 pt-3 dark:border-stone-800"
        }
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-stone-900 dark:text-stone-100">
            <CalendarClock className="size-3.5 text-[#f15a3a]" /> Schedule
          </h3>
          <span className="truncate text-[11px] text-muted-foreground">
            {timeZoneLabel()}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
          <Popover open={dayOpen} onOpenChange={setDayOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full justify-start gap-2 px-3 font-normal"
                aria-label="Day"
              >
                <CalendarDays className="size-4 text-stone-500" />
                <span className="truncate">
                  {pickDay.toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
                <ChevronDown className="ml-auto size-3.5 text-stone-400" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                required
                selected={pickDay}
                defaultMonth={pickDay}
                onSelect={(day) => {
                  if (day) setPickDay(day)
                  setDayOpen(false)
                }}
                disabled={[{ before: today }, { after: lastDay }]}
              />
            </PopoverContent>
          </Popover>
          <Input
            type="time"
            step={60}
            value={pickTime}
            onChange={(event) =>
              event.target.value && setPickTime(event.target.value)
            }
            className="h-9 w-full text-sm"
            aria-label="Time"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 gap-1.5">
            {quickSlots().map((slot) => {
              const active =
                dayKey(slot.at) === dayKey(pickDay) &&
                timeOf(slot.at) === pickTime
              return (
                <button
                  key={slot.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setPickDay(startOfDay(slot.at))
                    setPickTime(timeOf(slot.at))
                  }}
                  className={`h-8 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "border-[#f15a3a]/60 bg-orange-50 text-[#c2410c] dark:bg-orange-950/40 dark:text-orange-300"
                      : "border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  }`}
                >
                  {slot.label}
                </button>
              )
            })}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit("schedule")}
            disabled={
              submitting ||
              uploading > 0 ||
              !connectionReady ||
              !hasContent ||
              overLimit
            }
            title={`Publishes ${formatWhen(scheduleAt)}`}
            className="ml-auto h-8 shrink-0 rounded-full bg-[#191817] px-4 font-semibold text-white hover:bg-[#302e2c] dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            {submitting ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Clock3 />
            )}
            {note?.status === "scheduled" ? "Save schedule" : "Schedule"}
          </Button>
        </div>
      </section>
    </div>
  )
}
