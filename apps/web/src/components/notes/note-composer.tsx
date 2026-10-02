import { useEffect, useMemo, useRef, useState } from "react"
import {
  AtSign,
  CalendarClock,
  CalendarDays,
  FileText,
  ImagePlus,
  Link2,
  LoaderCircle,
  Send,
  X,
  Zap,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import type { Person } from "../../lib/types"
import {
  errorMessage,
  formatWhen,
  jsonInit,
  MAX_SCHEDULE_DAYS,
  NOTE_MAX_ATTACHMENTS,
  NOTE_TEXT_LIMIT,
  notesApi,
  replyRoleLabels,
  timeZoneLabel,
  type NoteAttachment,
  type NoteMention,
  type NoteMode,
  type NoteReplyRole,
  type ScheduledNote,
  type UploadedImage,
} from "../../lib/notes"

const DAY_MS = 24 * 60 * 60 * 1000
const ACCEPTED_IMAGES = "image/png,image/jpeg,image/gif,image/webp"

function atTime(day: Date, time: string): Date {
  const [hours = 9, minutes = 0] = time.split(":").map(Number)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
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
  const tomorrow = atTime(new Date(now.getTime() + DAY_MS), "09:00")
  const monday = new Date(now)
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7))
  return [
    { label: "In 1 hour", at: inHour },
    { label: "Tomorrow 9:00", at: tomorrow },
    { label: "Monday 9:00", at: atTime(monday, "09:00") },
  ]
}

function initialMode(note: ScheduledNote | null): NoteMode {
  if (note) return note.status === "scheduled" ? "schedule" : "draft"
  return "schedule"
}

/** Matches an `@query` immediately before the caret. */
function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const match = text.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}._-]{0,40})$/u)
  if (!match) return null
  const query = match[1] ?? ""
  return { query, start: caret - query.length - 1 }
}

function mentionToken(mention: NoteMention): string {
  return `@${(mention.handle ?? mention.label).replace(/^@/, "")}`
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
}

export function NoteComposer({
  note = null,
  seed = null,
  initialDate = null,
  connectionReady,
  onSaved,
  onCancel,
}: {
  note?: ScheduledNote | null
  /** Prefilled content for a new Note, such as a duplicate. */
  seed?: { markdown: string; mentions: NoteMention[] } | null
  initialDate?: Date | null
  connectionReady: boolean
  onSaved: (note: ScheduledNote, mode: NoteMode) => void
  onCancel?: () => void
}) {
  const isEdit = Boolean(note)
  const canEditText = !note || note.editable
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(crypto.randomUUID())

  const [markdown, setMarkdown] = useState(note ? note.markdown ?? note.bodyText : seed?.markdown ?? "")
  const [mentions, setMentions] = useState<NoteMention[]>(note?.mentions ?? seed?.mentions ?? [])
  const [kept, setKept] = useState<NoteAttachment[]>(note?.attachments ?? [])
  const [images, setImages] = useState<UploadedImage[]>([])
  const [link, setLink] = useState("")
  const [replyRole, setReplyRole] = useState<NoteReplyRole>(note?.replyMinimumRole ?? "everyone")
  const [mode, setMode] = useState<NoteMode>(initialMode(note))
  const scheduled = note?.triggerAt ? new Date(note.triggerAt) : initialDate
  const [day, setDay] = useState<Date | undefined>(scheduled ? startOfDay(scheduled) : undefined)
  const [time, setTime] = useState(scheduled && note?.triggerAt ? timeOf(scheduled) : "09:00")
  const [dayOpen, setDayOpen] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mention picker state.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [results, setResults] = useState<Person[]>([])
  const [highlight, setHighlight] = useState("")
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!mention || mention.query.length < 1) {
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/v1/people?search=${encodeURIComponent(mention.query)}&limit=25`, {
          signal: controller.signal,
        })
        const body = await res.json()
        const people = ((body.people ?? []) as Person[]).filter((p) => p.substackProfileId && p.handle).slice(0, 8)
        setResults(people)
        setHighlight(people[0]?.id ?? "")
      } catch {
        // Ignore aborted or failed lookups; the list just stays empty.
      } finally {
        setSearching(false)
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [mention?.query])

  const activeMentions = useMemo(
    () => mentions.filter((item) => markdown.includes(mentionToken(item))),
    [mentions, markdown],
  )
  const linkTrimmed = link.trim()
  const attachmentCount = kept.length + images.length + (linkTrimmed ? 1 : 0)
  const hasKeptLink = kept.some((item) => item.type === "link")
  const scheduleAt = day ? atTime(day, time) : null

  function updateMentionQuery(text: string, caret: number) {
    setMention(mentionQueryAt(text, caret))
  }

  function pickPerson(person: Person) {
    const handle = person.handle
    if (!mention || !handle || !person.substackProfileId) return
    const textarea = textareaRef.current
    const caret = textarea?.selectionStart ?? markdown.length
    const token = `@${handle} `
    const next = markdown.slice(0, mention.start) + token + markdown.slice(caret)
    setMarkdown(next)
    setMentions((prev) => [
      ...prev.filter((item) => mentionToken(item) !== `@${handle}`),
      { id: Number(person.substackProfileId), handle, label: person.name, url: person.profileUrl ?? null },
    ])
    setMention(null)
    requestAnimationFrame(() => {
      const position = mention.start + token.length
      textarea?.focus()
      textarea?.setSelectionRange(position, position)
    })
  }

  function startMention() {
    const textarea = textareaRef.current
    if (!textarea) return
    const caret = textarea.selectionStart ?? markdown.length
    const before = markdown.slice(0, caret)
    const insert = before && !/\s$/.test(before) ? " @" : "@"
    const next = before + insert + markdown.slice(caret)
    setMarkdown(next)
    const position = caret + insert.length
    setMention({ query: "", start: position - 1 })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(position, position)
    })
  }

  function onTextKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || results.length === 0) {
      if (event.key === "Escape") setMention(null)
      return
    }
    const index = Math.max(0, results.findIndex((person) => person.id === highlight))
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setHighlight(results[(index + step + results.length) % results.length]!.id)
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      pickPerson(results[index]!)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setMention(null)
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const room = NOTE_MAX_ATTACHMENTS - attachmentCount
    const picked = Array.from(files).slice(0, Math.max(0, room))
    if (picked.length < files.length) setError(`A Note can have at most ${NOTE_MAX_ATTACHMENTS} attachments.`)
    for (const file of picked) {
      if (file.size > 15 * 1024 * 1024) {
        setError(`${file.name} is larger than 15 MB.`)
        continue
      }
      setUploading((count) => count + 1)
      try {
        const form = new FormData()
        form.append("file", file)
        const { image } = await notesApi<{ image: UploadedImage }>("/notes/images", { method: "POST", body: form })
        setImages((prev) => [...prev, image])
      } catch (err) {
        setError(errorMessage(err, "Could not upload the image."))
      } finally {
        setUploading((count) => count - 1)
      }
    }
    if (fileRef.current) fileRef.current.value = ""
  }

  function validate(): string | null {
    if (!connectionReady) return "Connect your Substack account first."
    if (canEditText && !markdown.trim()) return "Write something first."
    if (markdown.length > NOTE_TEXT_LIMIT) return `Notes can be at most ${NOTE_TEXT_LIMIT.toLocaleString()} characters.`
    if (linkTrimmed && !/^https?:\/\/\S+$/i.test(linkTrimmed)) return "Links must start with http:// or https://."
    if (linkTrimmed && hasKeptLink) return "A Note can have only one link attachment."
    if (attachmentCount > NOTE_MAX_ATTACHMENTS) return `A Note can have at most ${NOTE_MAX_ATTACHMENTS} attachments.`
    if (mode === "schedule") {
      if (!scheduleAt) return "Pick a day to publish."
      if (scheduleAt.getTime() < Date.now() + 60_000) return "Pick a time at least a minute from now."
      if (scheduleAt.getTime() > Date.now() + MAX_SCHEDULE_DAYS * DAY_MS - 60 * 60 * 1000) {
        return `Substack schedules Notes up to ${MAX_SCHEDULE_DAYS} days ahead.`
      }
    }
    return null
  }

  async function submit() {
    const problem = validate()
    setError(problem)
    if (problem) return
    setSubmitting(true)
    const attachments = [
      ...kept.map((item) => ({ type: "existing" as const, id: item.id })),
      ...images.map((image) => ({ type: "image" as const, image })),
      ...(linkTrimmed ? [{ type: "link" as const, url: linkTrimmed }] : []),
    ]
    const content = {
      ...(canEditText ? { markdown, mentions: activeMentions } : {}),
      replyMinimumRole: replyRole,
      mode,
      triggerAt: mode === "schedule" ? scheduleAt!.toISOString() : null,
    }
    try {
      const { note: saved } = isEdit
        ? await notesApi<{ note: ScheduledNote }>(`/notes/${note!.id}`, jsonInit("PATCH", { ...content, attachments }))
        : await notesApi<{ note: ScheduledNote }>(
            "/notes",
            jsonInit("POST", {
              clientRequestId: requestId.current,
              ...content,
              attachments: attachments.filter((item) => item.type !== "existing"),
            }),
          )
      requestId.current = crypto.randomUUID()
      if (!isEdit) {
        setMarkdown("")
        setMentions([])
        setImages([])
        setLink("")
      }
      onSaved(saved, mode)
    } catch (err) {
      setError(errorMessage(err, "Could not save the Note."))
    } finally {
      setSubmitting(false)
    }
  }

  const submitLabel =
    mode === "post_now"
      ? "Post in 1 minute"
      : mode === "draft"
        ? isEdit && note?.status === "scheduled"
          ? "Move to drafts"
          : "Save draft"
        : scheduleAt
          ? `Schedule for ${formatWhen(scheduleAt)}`
          : "Schedule"
  const today = startOfDay(new Date())
  const lastDay = new Date(Date.now() + (MAX_SCHEDULE_DAYS - 1) * DAY_MS)

  return (
    <div className="space-y-4">
      {/* Body */}
      <div className="space-y-1.5">
        <Popover open={Boolean(mention && mention.query.length > 0)} onOpenChange={(open) => !open && setMention(null)}>
          <PopoverAnchor asChild>
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={markdown}
                disabled={!canEditText}
                onChange={(event) => {
                  setMarkdown(event.target.value)
                  updateMentionQuery(event.target.value, event.target.selectionStart)
                }}
                onKeyDown={onTextKeyDown}
                onClick={(event) => updateMentionQuery(markdown, event.currentTarget.selectionStart)}
                placeholder="What's on your mind? Type @ to mention someone from your circle."
                className="min-h-40 resize-y bg-white text-sm leading-relaxed dark:bg-stone-950"
                aria-label="Note text"
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-72 p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Command value={highlight} onValueChange={setHighlight} shouldFilter={false}>
              <CommandList>
                <CommandEmpty>{searching ? "Searching…" : "No contacts with a Substack profile match."}</CommandEmpty>
                <CommandGroup heading="Mention a contact">
                  {results.map((person) => (
                    <CommandItem
                      key={person.id}
                      value={person.id}
                      onSelect={() => pickPerson(person)}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <Avatar className="size-6">
                        {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
                        <AvatarFallback className="text-[10px]">{initials(person.name)}</AvatarFallback>
                      </Avatar>
                      <span className="truncate font-medium">{person.name}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">@{person.handle}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {!canEditText ? (
          <p className="text-[11px] text-muted-foreground">
            This Note uses formatting Circles can't edit, so only its time and audience can change here. Edit the text in Substack.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              **bold**, *italic*, lists, quotes and links work.
            </span>
            <span className={markdown.length > NOTE_TEXT_LIMIT ? "font-semibold text-destructive" : ""}>
              {markdown.length.toLocaleString()} / {NOTE_TEXT_LIMIT.toLocaleString()}
            </span>
          </div>
        )}

        {activeMentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeMentions.map((item) => (
              <span
                key={mentionToken(item)}
                className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-[#c2410c] dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300"
              >
                <AtSign className="size-3" />
                {item.label}
                {canEditText && (
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-orange-100 dark:hover:bg-orange-900/50"
                    onClick={() => setMentions((prev) => prev.filter((m) => mentionToken(m) !== mentionToken(item)))}
                    aria-label={`Post ${item.label} as plain text instead of a mention`}
                    title="Keep as plain text"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Attachments */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {canEditText && (
            <Button type="button" variant="outline" size="sm" onClick={startMention} className="rounded-full">
              <AtSign /> Mention
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={attachmentCount >= NOTE_MAX_ATTACHMENTS || uploading > 0 || !connectionReady}
            onClick={() => fileRef.current?.click()}
          >
            {uploading > 0 ? <LoaderCircle className="animate-spin" /> : <ImagePlus />} Image
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGES}
            multiple
            className="hidden"
            onChange={(event) => void uploadFiles(event.target.files)}
          />
          {!hasKeptLink && (
            <div className="relative min-w-48 flex-1">
              <Link2 className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="Attach a link (optional)"
                className="h-7 rounded-full pl-8 text-xs"
                aria-label="Link attachment"
              />
            </div>
          )}
        </div>

        {(kept.length > 0 || images.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {kept.map((item) => (
              <AttachmentChip
                key={item.id}
                imageUrl={item.imageUrl}
                label={item.type === "link" ? item.linkMetadata?.title || item.linkMetadata?.url || "Link" : item.type}
                onRemove={() => setKept((prev) => prev.filter((other) => other.id !== item.id))}
              />
            ))}
            {images.map((image) => (
              <AttachmentChip
                key={image.id}
                imageUrl={image.url}
                label="Image"
                onRemove={() => setImages((prev) => prev.filter((other) => other.id !== image.id))}
              />
            ))}
          </div>
        )}
      </div>

      {/* When */}
      <div className="space-y-3 rounded-xl border border-stone-200/80 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/50">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={mode}
          onValueChange={(value) => value && setMode(value as NoteMode)}
          className="w-full"
          aria-label="When to publish"
        >
          <ToggleGroupItem value="post_now" className="flex-1 text-xs">
            <Zap /> Post now
          </ToggleGroupItem>
          <ToggleGroupItem value="schedule" className="flex-1 text-xs">
            <CalendarClock /> Schedule
          </ToggleGroupItem>
          <ToggleGroupItem value="draft" className="flex-1 text-xs">
            <FileText /> Draft
          </ToggleGroupItem>
        </ToggleGroup>

        {mode === "post_now" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Posts one minute after you confirm. Until then you can abort and keep it as a draft.
          </p>
        )}
        {mode === "draft" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saved as an unscheduled draft in Substack, so it also shows up in Substack's own drafts.
          </p>
        )}
        {mode === "schedule" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Day</Label>
                <Popover open={dayOpen} onOpenChange={setDayOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-40 justify-start bg-white font-normal dark:bg-stone-950">
                      <CalendarDays />
                      {day ? day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "Pick a day"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={day}
                      defaultMonth={day}
                      onSelect={(value) => {
                        setDay(value)
                        setDayOpen(false)
                      }}
                      disabled={[{ before: today }, { after: lastDay }]}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label htmlFor="note-time" className="text-[11px] text-muted-foreground">Time</Label>
                <Input
                  id="note-time"
                  type="time"
                  step={60}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="h-7 w-32 bg-white text-xs dark:bg-stone-950"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickSlots().map((slot) => (
                <Button
                  key={slot.label}
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="rounded-full border border-stone-200 bg-white text-[11px] dark:border-stone-800 dark:bg-stone-950"
                  onClick={() => {
                    setDay(startOfDay(slot.at))
                    setTime(timeOf(slot.at))
                  }}
                >
                  {slot.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Times are in {timeZoneLabel()}.</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Label className="text-[11px] text-muted-foreground">Who can reply</Label>
          <Select value={replyRole} onValueChange={(value) => setReplyRole(value as NoteReplyRole)}>
            <SelectTrigger size="sm" className="h-7 w-44 bg-white text-xs dark:bg-stone-950">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(replyRoleLabels).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={submitting || uploading > 0 || !connectionReady}
          className="rounded-full bg-[#191817] px-4 text-white hover:bg-[#302e2c]"
        >
          {submitting ? <LoaderCircle className="animate-spin" /> : mode === "post_now" ? <Zap /> : <Send />}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

function AttachmentChip({ imageUrl, label, onRemove }: { imageUrl?: string; label: string; onRemove: () => void }) {
  return (
    <div className="group relative flex h-16 max-w-48 items-center gap-2 overflow-hidden rounded-lg border border-stone-200 bg-white pr-7 dark:border-stone-800 dark:bg-stone-950">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-16 object-cover" />
      ) : (
        <span className="flex h-full w-12 items-center justify-center bg-stone-100 dark:bg-stone-900">
          <Link2 className="size-4 text-stone-400" />
        </span>
      )}
      <span className="truncate pr-1 text-[11px] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-stone-500 shadow-xs hover:text-stone-900 dark:bg-stone-900/90"
        aria-label="Remove attachment"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
