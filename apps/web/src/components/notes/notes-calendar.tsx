import { ChevronLeft, ChevronRight, Plus } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import {
  dayKey,
  formatDay,
  formatTime,
  MAX_SCHEDULE_DAYS,
  noteMoment,
  noteTitle,
  type ScheduledNote,
} from "../../lib/notes"
import { isOpen, NoteStatusBadge, type NoteHandlers } from "./note-item"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const VISIBLE_PER_DAY = 3

const dotClasses: Record<string, string> = {
  pending: "bg-stone-400",
  draft: "bg-amber-400",
  scheduled: "bg-[#f15a3a]",
  published: "bg-emerald-500",
  deleted: "bg-rose-400",
}

/** Six Monday-first weeks covering the month. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  return Array.from(
    { length: 42 },
    (_, index) =>
      new Date(first.getFullYear(), first.getMonth(), index - offset + 1)
  )
}

function NoteChip({
  note,
  handlers,
}: {
  note: ScheduledNote
  handlers: NoteHandlers
}) {
  const moment = noteMoment(note)
  const content = (
    <>
      <span
        className={`size-1.5 shrink-0 rounded-full ${dotClasses[note.status]}`}
      />
      <span className="shrink-0 font-semibold tabular-nums">
        {moment ? formatTime(moment) : ""}
      </span>
      <span className="hidden truncate sm:inline">{noteTitle(note)}</span>
    </>
  )
  const className =
    "flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[10.5px] text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
  if (!isOpen(note) && note.noteUrl) {
    return (
      <a
        href={note.noteUrl}
        target="_blank"
        rel="noreferrer"
        className={className}
        title={note.bodyText}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    )
  }
  return (
    <button
      type="button"
      className={className}
      title={note.bodyText}
      disabled={!isOpen(note)}
      onClick={(event) => {
        event.stopPropagation()
        handlers.onEdit(note)
      }}
    >
      {content}
    </button>
  )
}

export function NotesCalendar({
  notes,
  handlers,
  month,
  onMonthChange,
  onCreateOn,
}: {
  notes: ScheduledNote[]
  handlers: NoteHandlers
  month: Date
  onMonthChange: (month: Date) => void
  onCreateOn: (day: Date) => void
}) {
  const byDay = new Map<string, ScheduledNote[]>()
  for (const note of notes) {
    const moment = noteMoment(note)
    if (!moment || note.status === "deleted") continue
    const key = dayKey(moment)
    byDay.set(key, [...(byDay.get(key) ?? []), note])
  }
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        (noteMoment(a)?.getTime() ?? 0) - (noteMoment(b)?.getTime() ?? 0)
    )
  }
  const drafts = notes.filter((note) => note.status === "draft")
  const today = new Date()
  const todayKey = dayKey(today)
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime()
  const lastSchedulable =
    startOfToday + (MAX_SCHEDULE_DAYS - 1) * 24 * 60 * 60 * 1000

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() =>
              onMonthChange(
                new Date(month.getFullYear(), month.getMonth() - 1, 1)
              )
            }
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1))
            }
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            onClick={() =>
              onMonthChange(
                new Date(month.getFullYear(), month.getMonth() + 1, 1)
              )
            }
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="grid grid-cols-7 border-b border-stone-200/80 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-1.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {monthGrid(month).map((day, index) => {
            const key = dayKey(day)
            const dayNotes = byDay.get(key) ?? []
            const inMonth = day.getMonth() === month.getMonth()
            const schedulable =
              day.getTime() >= startOfToday && day.getTime() <= lastSchedulable
            const hidden = dayNotes.length - VISIBLE_PER_DAY
            return (
              <div
                key={key}
                // The whole day schedules a Note; chips inside stop propagation.
                {...(schedulable && {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `Schedule a Note on ${formatDay(day)}`,
                  onClick: () => onCreateOn(day),
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault()
                      onCreateOn(day)
                    }
                  },
                })}
                className={`group relative min-h-24 border-stone-200/80 p-1 outline-none dark:border-stone-800 ${
                  index % 7 !== 6 ? "border-r" : ""
                } ${index < 35 ? "border-b" : ""} ${inMonth ? "" : "bg-stone-50/70 dark:bg-stone-950/50"} ${
                  schedulable
                    ? "cursor-pointer transition-colors hover:bg-orange-50/50 focus-visible:bg-orange-50/70 focus-visible:ring-2 focus-visible:ring-[#f15a3a]/40 focus-visible:ring-inset dark:hover:bg-orange-950/20"
                    : ""
                }`}
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <span
                    className={`flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                      key === todayKey
                        ? "bg-[#f15a3a] font-bold text-white"
                        : inMonth
                          ? "text-stone-700 dark:text-stone-300"
                          : "text-stone-400"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {schedulable && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation()
                        onCreateOn(day)
                      }}
                      className="rounded p-0.5 text-stone-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-800 focus:opacity-100 dark:hover:bg-stone-800"
                      aria-label={`Schedule a Note on ${formatDay(day)}`}
                    >
                      <Plus className="size-3" />
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {dayNotes.slice(0, VISIBLE_PER_DAY).map((note) => (
                    <NoteChip key={note.id} note={note} handlers={handlers} />
                  ))}
                  {hidden > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          className="px-1 text-[10.5px] font-medium text-stone-500 hover:text-stone-900"
                        >
                          +{hidden} more
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-72 space-y-1 p-2"
                        align="start"
                        // Portaled content still bubbles through React to the day cell.
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <p className="px-1 pb-1 text-xs font-semibold">
                          {formatDay(day)}
                        </p>
                        {dayNotes.map((note) => (
                          <div
                            key={note.id}
                            className="flex items-center gap-1"
                          >
                            <NoteChip note={note} handlers={handlers} />
                            <NoteStatusBadge note={note} />
                          </div>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {(["scheduled", "published", "pending"] as const).map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span className={`size-1.5 rounded-full ${dotClasses[status]}`} />
            {status === "pending"
              ? "Saving"
              : status[0]!.toUpperCase() + status.slice(1)}
          </span>
        ))}
      </div>

      {drafts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
            Unscheduled drafts · {drafts.length}
          </h3>
          <div className="flex flex-wrap gap-2">
            {drafts.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => handlers.onEdit(note)}
                className="flex max-w-64 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1 text-left text-[11px] text-stone-700 hover:border-amber-300 dark:border-amber-900 dark:bg-amber-950/30 dark:text-stone-300"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${dotClasses.draft}`}
                />
                <span className="truncate">{noteTitle(note)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
