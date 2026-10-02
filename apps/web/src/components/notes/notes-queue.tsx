import { CalendarClock, CheckCircle2, FileText } from "lucide-react"

import {
  dayKey,
  formatDay,
  noteMoment,
  type ScheduledNote,
} from "../../lib/notes"
import { NoteCard, type NoteHandlers } from "./note-item"

const PUBLISHED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

function groupByDay(notes: ScheduledNote[]) {
  const groups = new Map<string, { date: Date; notes: ScheduledNote[] }>()
  for (const note of notes) {
    const moment = noteMoment(note)
    if (!moment) continue
    const key = dayKey(moment)
    const group = groups.get(key) ?? { date: moment, notes: [] }
    group.notes.push(note)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function dayHeading(date: Date): string {
  const today = dayKey(new Date())
  const tomorrow = dayKey(new Date(Date.now() + 24 * 60 * 60 * 1000))
  const key = dayKey(date)
  if (key === today) return `Today · ${formatDay(date)}`
  if (key === tomorrow) return `Tomorrow · ${formatDay(date)}`
  return formatDay(date)
}

function Section({
  icon: Icon,
  title,
  count,
  empty,
  children,
}: {
  icon: typeof FileText
  title: string
  count: number
  empty: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
        <Icon className="size-3.5" /> {title}
        <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800">
          {count}
        </span>
      </h2>
      {count === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        children
      )}
    </section>
  )
}

export function NotesQueue({
  notes,
  handlers,
}: {
  notes: ScheduledNote[]
  handlers: NoteHandlers
}) {
  const upcoming = notes
    .filter((note) => note.status === "scheduled" || note.status === "pending")
    .sort(
      (a, b) =>
        (noteMoment(a)?.getTime() ?? Infinity) -
        (noteMoment(b)?.getTime() ?? Infinity)
    )
  const drafts = notes
    .filter((note) => note.status === "draft")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const cutoff = Date.now() - PUBLISHED_WINDOW_MS
  const published = notes
    .filter(
      (note) =>
        note.status === "published" &&
        (noteMoment(note)?.getTime() ?? 0) >= cutoff
    )
    .sort(
      (a, b) =>
        (noteMoment(b)?.getTime() ?? 0) - (noteMoment(a)?.getTime() ?? 0)
    )

  return (
    <div className="space-y-6">
      <Section
        icon={CalendarClock}
        title="Scheduled"
        count={upcoming.length}
        empty="Nothing scheduled yet."
      >
        <div className="space-y-4">
          {groupByDay(upcoming).map((group) => (
            <div key={dayKey(group.date)} className="space-y-2">
              <p className="sticky top-16 z-10 bg-[#f7f5f1]/90 px-1 py-1 text-xs font-semibold text-stone-800 backdrop-blur dark:bg-stone-950/90 dark:text-stone-200">
                {dayHeading(group.date)}
              </p>
              {group.notes.map((note) => (
                <NoteCard key={note.id} note={note} handlers={handlers} />
              ))}
            </div>
          ))}
          {upcoming
            .filter((note) => !noteMoment(note))
            .map((note) => (
              <NoteCard key={note.id} note={note} handlers={handlers} />
            ))}
        </div>
      </Section>

      <Section
        icon={FileText}
        title="Drafts"
        count={drafts.length}
        empty="No unscheduled drafts."
      >
        <div className="space-y-2">
          {drafts.map((note) => (
            <NoteCard key={note.id} note={note} handlers={handlers} />
          ))}
        </div>
      </Section>

      <Section
        icon={CheckCircle2}
        title="Published · last 14 days"
        count={published.length}
        empty="No Notes published in the last 14 days."
      >
        <div className="space-y-2">
          {published.map((note) => (
            <NoteCard key={note.id} note={note} handlers={handlers} />
          ))}
        </div>
      </Section>
    </div>
  )
}
