import { useEffect, useState } from "react"
import { CalendarClock, Plus, Search, UserRound } from "lucide-react"
import { normalizeAppOrigin, pairAppOrigin } from "../lib/app-origin"
import type { FlowState } from "../lib/types"
import {
  circles, findByHandle, message, openInCircles, queues,
  type Interaction, type ListRecord, type Person, type QueueView, type ScheduledNote,
} from "./api"
import {
  Avatar, btnOutline, btnPrimary, card, describeAction, eyebrow, field, Notice, PersonRow, pillIn, pillOut, timeAgo,
} from "./ui"

export type Target =
  | { kind: "person"; person: Person }
  | { kind: "handle"; handle: string; name: string | null }
  | null

const divided = `${card} divide-y divide-stone-100 dark:divide-stone-800`

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}

function directionPill(direction: string | null | undefined) {
  if (direction === "outbound") return <span className={pillOut}>Out</span>
  if (direction === "inbound") return <span className={pillIn}>In</span>
  return null
}

function activity(person: Person) {
  const what = describeAction(person.lastActionType, person.lastActionDirection)
  return person.lastInteractionAt ? `${what} · ${timeAgo(person.lastInteractionAt)}` : "No activity yet"
}

function parseTags(text: string) {
  return [...new Set(text.split(",").map((tag) => tag.trim()).filter((tag) => tag && tag.length <= 32))].slice(0, 8)
}

/* ---------------- This page ---------------- */

export function PageView({ target, lists, onLookup, onSelect, onChanged }: {
  target: Target
  lists: Array<{ id: string; name: string }>
  onLookup: (handle: string) => void
  onSelect: (person: Person) => void
  onChanged: () => void
}) {
  const [person, setPerson] = useState<Person | null>(null)
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState<Interaction[]>([])
  const [listIds, setListIds] = useState<Set<string>>(new Set())
  const [tags, setTags] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [reload, setReload] = useState(0)
  const key = target?.kind === "person" ? target.person.id : target?.handle ?? ""

  useEffect(() => {
    let live = true
    setNotice(null)
    setRecent([])
    if (!target) {
      setPerson(null)
      return
    }
    setLoading(true)
    void (async () => {
      const found = target.kind === "person" ? target.person : await findByHandle(target.handle)
      const full = found ? (await circles<{ person: Person }>(`/api/v1/people/${found.id}`)).person : null
      if (!live) return
      setPerson(full)
      setListIds(new Set(full?.lists?.map((list) => list.id) ?? []))
      setTags(full?.tags?.map((tag) => tag.name).join(", ") ?? "")
      setNotes(full?.notes ?? "")
      if (full) {
        const page = await circles<{ interactions: Interaction[] }>(`/api/v1/people/${full.id}/interactions?limit=5`)
        if (live) setRecent(page.interactions)
      }
    })()
      .catch((error) => live && setNotice({ tone: "error", text: errorText(error) }))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [key, reload])

  async function save() {
    if (!target) return
    setSaving(true)
    setNotice(null)
    try {
      const tagNames = parseTags(tags)
      if (!person) {
        const handle = target.kind === "handle" ? target.handle : target.person.handle ?? ""
        await circles("/api/ext/person", {
          method: "POST",
          body: { name: target.kind === "handle" ? target.name ?? handle : target.person.name, handle, lists: [...listIds], tags: tagNames },
        })
      } else {
        const before = new Set(person.lists?.map((list) => list.id) ?? [])
        for (const id of listIds) {
          if (!before.has(id)) await circles(`/api/v1/lists/${id}/members`, { method: "POST", body: { personId: person.id } })
        }
        for (const id of before) {
          if (!listIds.has(id)) await circles(`/api/v1/lists/${id}/members/${person.id}`, { method: "DELETE" })
        }
        const current = new Map((person.tags ?? []).map((tag) => [tag.name.toLocaleLowerCase("en"), tag.id]))
        const wanted = new Set(tagNames.map((name) => name.toLocaleLowerCase("en")))
        const missing = tagNames.filter((name) => !current.has(name.toLocaleLowerCase("en")))
        if (missing.length) {
          const { tags: all } = await circles<{ tags: Array<{ id: string; name: string }> }>("/api/v1/tags")
          const byName = new Map(all.map((tag) => [tag.name.toLocaleLowerCase("en"), tag.id]))
          for (const name of missing) {
            const id = byName.get(name.toLocaleLowerCase("en")) ??
              (await circles<{ tag: { id: string } }>("/api/v1/tags", { method: "POST", body: { name } })).tag.id
            await circles(`/api/v1/tags/${id}/people`, { method: "POST", body: { personId: person.id } })
          }
        }
        for (const [name, id] of current) {
          if (!wanted.has(name)) await circles(`/api/v1/tags/${id}/people/${person.id}`, { method: "DELETE" })
        }
        if ((person.notes ?? "") !== notes) {
          await circles(`/api/v1/people/${person.id}`, { method: "PATCH", body: { notes: notes.trim() || null } })
        }
      }
      setNotice({ tone: "ok", text: "Saved to Circles." })
      setReload((value) => value + 1)
      onChanged()
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  if (!target) return <NoProfile onLookup={onLookup} onSelect={onSelect} />

  const name = person?.name ?? (target.kind === "handle" ? target.name ?? target.handle : target.person.name)
  const handle = person?.handle ?? (target.kind === "handle" ? target.handle : target.person.handle)
  const facts = [handle && `@${handle}`, person?.isSubscriber && "Subscriber", person?.isFollower && "Follows you"].filter(Boolean)

  return (
    <>
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-start gap-2.5 p-3">
          <Avatar person={{ name, avatarUrl: person?.avatarUrl }} size="size-10 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-[11px] text-stone-500">{facts.join(" · ")}</p>
          </div>
          {loading ? null : person
            ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">In Circles</span>
            : <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">Not in Circles</span>}
        </div>

        {person && (
          <div className="grid grid-cols-3 divide-x divide-stone-200/80 border-y border-stone-200/80 bg-stone-50/80 dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-950/40">
            <Stat label="Inbound" value={person.inboundInteractionCount} />
            <Stat label="Outbound" value={person.outboundInteractionCount} />
            <Stat label="Last touch" value={timeAgo(person.lastInteractionAt) || "–"} />
          </div>
        )}

        <div className="space-y-3 p-3">
          <div className="space-y-1.5">
            <p className={eyebrow}>Lists</p>
            {lists.length === 0
              ? <p className="text-stone-500">No lists yet. Create lists in Circles.</p>
              : (
                <div className="grid gap-1">
                  {lists.map((list) => (
                    <label key={list.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200/70 px-2.5 py-1.5 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/60">
                      <input
                        type="checkbox"
                        className="accent-[#f15a3a]"
                        checked={listIds.has(list.id)}
                        onChange={(event) => {
                          const next = new Set(listIds)
                          if (event.target.checked) next.add(list.id)
                          else next.delete(list.id)
                          setListIds(next)
                        }}
                      />
                      <span className="flex-1 truncate">{list.name}</span>
                    </label>
                  ))}
                </div>
              )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="person-tags" className={eyebrow}>Tags</label>
            <input id="person-tags" className={field} placeholder="writer, collab" value={tags} onChange={(event) => setTags(event.target.value)} />
          </div>
          {person && (
            <div className="space-y-1.5">
              <label htmlFor="person-notes" className={eyebrow}>Private note</label>
              <textarea id="person-notes" rows={2} className={`${field} h-auto py-1.5`} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          )}
          <button type="button" className={`${btnPrimary} w-full`} disabled={saving || loading} onClick={() => void save()}>
            <Plus className="size-3.5" />
            {saving ? "Saving…" : person ? "Save changes" : "Add to Circles"}
          </button>
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <div className="grid grid-cols-2 gap-1.5">
            {person && (
              <button type="button" className={`${btnOutline} h-7 text-[11px]`} onClick={() => void openInCircles(`/?person=${encodeURIComponent(person.id)}`)}>
                Open in Circles
              </button>
            )}
            {handle && (
              <a className={`${btnOutline} h-7 text-[11px] ${person ? "" : "col-span-2"}`} href={`https://substack.com/@${encodeURIComponent(handle)}`} target="_blank" rel="noreferrer">
                View on Substack
              </a>
            )}
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className={`${card} space-y-1.5 p-3`}>
          <p className={eyebrow}>Recent</p>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {recent.map((item) => (
              <li key={item.id} className="flex items-center gap-2 py-1.5">
                {directionPill(item.direction)}
                <span className="flex-1 truncate">{describeAction(item.actionType, item.direction, item.targetType)}</span>
                <time className="text-[11px] tabular-nums text-stone-500">{timeAgo(item.occurredAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-3 py-2">
      <span className={`${eyebrow} block`}>{label}</span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  )
}

function NoProfile({ onLookup, onSelect }: {
  onLookup: (handle: string) => void
  onSelect: (person: Person) => void
}) {
  const [handle, setHandle] = useState("")
  const [replies, setReplies] = useState<Person[]>([])
  useEffect(() => {
    circles<{ people: Person[] }>("/api/v1/people?view=needs-reply&limit=3")
      .then(({ people }) => setReplies(people))
      .catch(() => setReplies([]))
  }, [])
  const lookup = () => {
    const clean = handle.trim().replace(/^@/, "").toLocaleLowerCase("en")
    if (clean) onLookup(clean)
  }
  return (
    <>
      <section className={`${card} space-y-3 border-dashed p-3`}>
        <div className="flex items-start gap-2.5">
          <UserRound className="mt-0.5 size-4 shrink-0 text-stone-400" />
          <div className="space-y-0.5">
            <p className="font-semibold">Open a Substack profile or Note</p>
            <p className="text-stone-500">The person on the current tab shows up here. You can also add someone by handle.</p>
          </div>
        </div>
        <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); lookup() }}>
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-stone-400">@</span>
            <input aria-label="Substack handle" placeholder="handle" className={`${field} pl-6`} value={handle} onChange={(event) => setHandle(event.target.value)} />
          </div>
          <button type="submit" className={btnOutline}>Look up</button>
        </form>
      </section>
      {replies.length > 0 && (
        <section className="space-y-1.5">
          <p className={`${eyebrow} px-1`}>Needs your reply</p>
          <div className={divided}>
            {replies.map((person) => (
              <PersonRow key={person.id} person={person} detail={activity(person)} trailing={directionPill(person.lastActionDirection)} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/* ---------------- Today ---------------- */

export interface TodayData {
  received: number
  given: number
  contacts: number
  queues: Record<QueueView, Person[]>
}

export async function loadToday(): Promise<TodayData> {
  const [overview, ...lists] = await Promise.all([
    circles<{ people: number; actions?: Array<{ direction: string; last7d: number }> }>("/api/v1/circles"),
    ...queues.map((queue) => circles<{ people: Person[] }>(`/api/v1/people?view=${queue.view}&limit=100`)),
  ])
  const sum = (direction: string) =>
    (overview.actions ?? []).filter((action) => action.direction === direction).reduce((total, action) => total + action.last7d, 0)
  return {
    received: sum("inbound"),
    given: sum("outbound"),
    contacts: overview.people,
    queues: Object.fromEntries(queues.map((queue, index) => [queue.view, lists[index]!.people])) as TodayData["queues"],
  }
}

export function countLabel(people: Person[]) {
  return people.length >= 100 ? "100+" : String(people.length)
}

export function TodayView({ data, error, onSelect }: { data: TodayData | null; error: string | null; onSelect: (person: Person) => void }) {
  if (error) return <Notice>{error}</Notice>
  if (!data) return <p className="text-stone-500">Loading…</p>
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <Tile label="Received 7d" value={data.received} />
        <Tile label="Given 7d" value={data.given} />
        <Tile label="Contacts" value={data.contacts.toLocaleString()} />
      </div>
      {queues.map((queue) => {
        const people = data.queues[queue.view]
        return (
          <section key={queue.view} className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <p className={eyebrow}>{queue.label} · {countLabel(people)}</p>
              <button type="button" className="text-[11px] font-medium text-[#f15a3a] hover:underline" onClick={() => void openInCircles(`/?view=${queue.view}`)}>See all</button>
            </div>
            {people.length === 0
              ? <p className="px-1 text-stone-500">Nothing here right now.</p>
              : (
                <div className={divided}>
                  {people.slice(0, 3).map((person) => (
                    <PersonRow key={person.id} person={person} detail={activity(person)} trailing={directionPill(person.lastActionDirection)} onSelect={onSelect} />
                  ))}
                </div>
              )}
          </section>
        )
      })}
    </>
  )
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={`${card} px-2.5 py-2`}>
      <span className={`${eyebrow} block`}>{label}</span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  )
}

/* ---------------- People ---------------- */

export function PeopleView({ total, onSelect }: { total: number | null; onSelect: (person: Person) => void }) {
  const [search, setSearch] = useState("")
  const [listId, setListId] = useState<string | null>(null)
  const [lists, setLists] = useState<ListRecord[]>([])
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    circles<{ lists: ListRecord[] }>("/api/v1/lists").then(({ lists }) => setLists(lists)).catch(() => setLists([]))
  }, [])

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ sort: "recent_interaction", limit: "50" })
      if (search.trim()) params.set("search", search.trim())
      if (listId) params.set("listId", listId)
      circles<{ people: Person[] }>(`/api/v1/people?${params}`)
        .then(({ people }) => { if (live) { setPeople(people); setError(null) } })
        .catch((reason) => live && setError(errorText(reason)))
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [search, listId])

  const chip = (active: boolean) => active
    ? "rounded-full bg-stone-900 px-2.5 py-0.5 text-[11px] font-medium text-white dark:bg-stone-100 dark:text-stone-900"
    : "rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone-400" />
        <input
          type="search"
          aria-label="Search contacts"
          placeholder={total === null ? "Search contacts" : `Search ${total.toLocaleString()} contacts`}
          className={`${field} pl-8`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {lists.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button type="button" className={chip(listId === null)} onClick={() => setListId(null)}>All</button>
          {lists.map((list) => (
            <button key={list.id} type="button" className={chip(listId === list.id)} onClick={() => setListId(list.id)}>
              {list.name} {list.count}
            </button>
          ))}
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {people === null ? <p className="text-stone-500">Loading…</p> : people.length === 0
        ? <p className="px-1 text-stone-500">No contacts match.</p>
        : (
          <div className={divided}>
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                detail={[person.handle && `@${person.handle}`, person.lists?.map((list) => list.name).join(", ")].filter(Boolean).join(" · ")}
                trailing={<span className="shrink-0 text-[11px] tabular-nums text-stone-500">{person.inboundInteractionCount} in · {person.outboundInteractionCount} out</span>}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
    </>
  )
}

/* ---------------- Notes ---------------- */

/** Plain text to the ProseMirror document the Notes API expects: one paragraph per line. */
export function noteDoc(text: string) {
  return {
    type: "doc",
    content: text.split("\n").map((line) => line.trim()
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" }),
  }
}

function localInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function whenLabel(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""
}

export function NotesView() {
  const [notes, setNotes] = useState<ScheduledNote[] | null>(null)
  const [text, setText] = useState("")
  const [scheduling, setScheduling] = useState(false)
  const [when, setWhen] = useState(() => localInputValue(new Date(Date.now() + 60 * 60_000)))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [posting, setPosting] = useState<ScheduledNote | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    circles<{ notes: ScheduledNote[] }>("/api/v1/notes")
      .then(({ notes }) => setNotes(notes))
      .catch((error) => setNotice({ tone: "error", text: errorText(error) }))
  }, [reload])

  async function submit(mode: "schedule" | "post_now") {
    if (!text.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      const { note } = await circles<{ note: ScheduledNote }>("/api/v1/notes", {
        method: "POST",
        body: {
          clientRequestId: crypto.randomUUID(),
          bodyJson: noteDoc(text),
          mode,
          triggerAt: mode === "schedule" ? new Date(when).toISOString() : null,
        },
      })
      setText("")
      setScheduling(false)
      setPosting(mode === "post_now" ? note : null)
      setNotice({ tone: "ok", text: mode === "post_now" ? "Posting in about a minute." : `Scheduled for ${whenLabel(note.triggerAt)}.` })
      setReload((value) => value + 1)
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  async function abort() {
    if (!posting) return
    try {
      await circles(`/api/v1/notes/${posting.id}/abort`, { method: "POST" })
      setNotice({ tone: "ok", text: "Stopped. The Note is back in your drafts." })
      setPosting(null)
      setReload((value) => value + 1)
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) })
    }
  }

  const weekAgo = Date.now() - 7 * 24 * 60 * 60_000
  const scheduled = (notes ?? []).filter((note) => note.status === "scheduled")
    .sort((a, b) => String(a.triggerAt).localeCompare(String(b.triggerAt)))
  const published = (notes ?? []).filter((note) => note.status === "published" && note.publishedAt && Date.parse(note.publishedAt) > weekAgo)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 5)

  return (
    <>
      <section className={`${card} space-y-2 p-3`}>
        <textarea rows={3} aria-label="New Note" placeholder="Write a Note…" className={`${field} h-auto py-2 text-[13px]`} value={text} onChange={(event) => setText(event.target.value)} />
        {scheduling && (
          <div className="flex items-center gap-1.5">
            <input type="datetime-local" aria-label="Publish at" className={`${field} min-w-0 flex-1`} value={when} onChange={(event) => setWhen(event.target.value)} />
            <button type="button" className={`${btnPrimary} h-7 px-2.5 text-[11px]`} disabled={busy || !text.trim()} onClick={() => void submit("schedule")}>Schedule</button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-stone-500">Substack publishes it at the time you pick.</span>
          <button type="button" className={`${btnOutline} ml-auto h-7 px-2.5 text-[11px]`} onClick={() => setScheduling(!scheduling)}>
            <CalendarClock className="size-3" />{scheduling ? "Cancel" : "Schedule"}
          </button>
          <button type="button" className={`${btnPrimary} h-7 px-2.5 text-[11px]`} disabled={busy || !text.trim()} onClick={() => void submit("post_now")}>Post now</button>
        </div>
        {notice && (
          <div className="flex items-center gap-2">
            <Notice tone={notice.tone}>{notice.text}</Notice>
            {posting && <button type="button" className="text-[11px] font-semibold text-[#f15a3a] hover:underline" onClick={() => void abort()}>Stop</button>}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <p className={`${eyebrow} px-1`}>Scheduled · {scheduled.length}</p>
        {scheduled.length === 0
          ? <p className="px-1 text-stone-500">Nothing scheduled.</p>
          : (
            <div className={divided}>
              {scheduled.map((note) => (
                <div key={note.id} className="space-y-1 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">{whenLabel(note.triggerAt)}</span>
                    {note.tags.map((tag) => <span key={tag.id} className="text-[11px] text-stone-500">#{tag.name}</span>)}
                  </div>
                  <p className="line-clamp-2">{note.bodyText}</p>
                </div>
              ))}
            </div>
          )}
      </section>

      {published.length > 0 && (
        <section className="space-y-1.5">
          <p className={`${eyebrow} px-1`}>Published this week</p>
          <div className={divided}>
            {published.map((note) => (
              <div key={note.id} className="flex items-center gap-2 p-2.5">
                <p className="min-w-0 flex-1 truncate">{note.bodyText}</p>
                <span className="shrink-0 text-[11px] tabular-nums text-stone-500">{timeAgo(note.publishedAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <button type="button" className={`${btnOutline} w-full`} onClick={() => void openInCircles("/notes")}>Open the Notes calendar</button>
    </>
  )
}

/* ---------------- Setup, connection and settings ---------------- */

export function PairForm({ current, onPaired }: { current: string | null; onPaired: () => void }) {
  const [value, setValue] = useState(current ?? "")
  const [error, setError] = useState<string | null>(null)
  return (
    <section className={`${card} space-y-3 p-3`}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Pair your Circles server</h2>
        <p className="text-stone-500">Enter the address you use to open Circles. Chrome asks once for access to that site.</p>
      </div>
      <form
        className="space-y-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          const origin = normalizeAppOrigin(value)
          if (!origin) return setError("Enter your Circles https address (http only for localhost).")
          // Ask Chrome for access while this submit still counts as a user gesture.
          void pairAppOrigin(origin).then(async (paired) => {
            if (!paired) return setError("Chrome access to that server was not granted.")
            setError(null)
            await message({ type: "APP_PAIRED" })
            onPaired()
          })
        }}
      >
        <label htmlFor="server" className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300">Circles server</label>
        <div className="flex gap-1.5">
          <input id="server" type="url" placeholder="https://circles.example.com" className={`${field} min-w-0 flex-1`} value={value} onChange={(event) => setValue(event.target.value)} />
          <button type="submit" className={btnPrimary}>Pair</button>
        </div>
        {error ? <Notice>{error}</Notice> : <p className="text-[11px] text-stone-500">Use https. Plain http works only for localhost.</p>}
      </form>
    </section>
  )
}

const PUBLICATION_URL = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.substack\.com\/?$/i

function flowText(flow: FlowState) {
  switch (flow.phase) {
    case "waiting-substack-login": return "Waiting for you to log in on Substack…"
    case "sending": return "Encrypting and sending your session…"
    case "done": return "Connected to Circles."
    case "failed": return flow.message
    default: return ""
  }
}

export function ConnectCard({ flow, publicationUrl }: { flow: FlowState; publicationUrl: string | null }) {
  const [url, setUrl] = useState(publicationUrl ?? "")
  const [error, setError] = useState<string | null>(null)
  const busy = flow.phase === "waiting-substack-login" || flow.phase === "sending" || flow.phase === "asking-publication"
  return (
    <section className={`${card} space-y-2.5 p-3`}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Connect your Substack account</h2>
        <p className="text-stone-500">Circles syncs your notifications, Notes and replies with your Substack session. You stay logged in on Substack as usual.</p>
      </div>
      {flow.phase === "asking-publication" ? (
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (url.trim() && !PUBLICATION_URL.test(url.trim())) return setError("Enter a https://…substack.com address, or skip.")
            setError(null)
            void message({ type: "SUBMIT_PUBLICATION_URL", flowId: flow.flowId, publicationUrl: url.trim() || null })
          }}
        >
          <label htmlFor="publication" className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300">
            Publication URL <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <input id="publication" type="url" placeholder="https://your-pub.substack.com" className={field} value={url} onChange={(event) => setUrl(event.target.value)} />
          {error && <Notice>{error}</Notice>}
          <div className="flex justify-end gap-1.5">
            <button type="button" className={btnOutline} onClick={() => void message({ type: "SUBMIT_PUBLICATION_URL", flowId: flow.flowId, publicationUrl: null })}>Skip</button>
            <button type="submit" className={btnPrimary}>Continue</button>
          </div>
        </form>
      ) : (
        <button type="button" className={`${btnPrimary} w-full`} disabled={busy} onClick={() => void message({ type: "START_CONNECT_FLOW" })}>
          {busy ? "Connecting…" : "Connect Substack"}
        </button>
      )}
      {flowText(flow) && <p className={`text-[11px] ${flow.phase === "failed" ? "text-rose-600 dark:text-rose-400" : "text-stone-500"}`}>{flowText(flow)}</p>}
    </section>
  )
}

export function SettingsView({ origin, account, queued, inPage, onChangeServer, onInPage }: {
  origin: string
  account: string | null
  queued: number
  inPage: boolean
  onChangeServer: () => void
  onInPage: (on: boolean) => void
}) {
  const row = "flex items-center gap-2 p-3"
  return (
    <section className={divided}>
      <div className={row}>
        <div className="min-w-0 flex-1"><p className={eyebrow}>Circles server</p><p className="truncate font-medium">{new URL(origin).host}</p></div>
        <button type="button" className={`${btnOutline} h-7 text-[11px]`} onClick={onChangeServer}>Change</button>
      </div>
      <div className={row}>
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>Substack account</p>
          <p className="truncate font-medium">
            <span className={`mr-1 inline-block size-1.5 rounded-full align-middle ${account ? "bg-emerald-500" : "bg-amber-500"}`} />
            {account ? `${account} · connected` : "Not connected"}
          </p>
        </div>
        <button type="button" className={`${btnOutline} h-7 text-[11px]`} onClick={() => void message({ type: "START_CONNECT_FLOW" })}>
          {account ? "Reconnect" : "Connect"}
        </button>
      </div>
      <div className={row}>
        <div className="min-w-0 flex-1"><p className={eyebrow}>Captures</p><p className="font-medium">{queued === 0 ? "All sent" : `${queued} waiting to send`}</p></div>
      </div>
      <label className={`${row} cursor-pointer`}>
        <div className="min-w-0 flex-1"><p className={eyebrow}>In-page buttons</p><p className="text-stone-500">Show Circles on Substack Notes and profiles</p></div>
        <input type="checkbox" className="accent-[#f15a3a]" checked={inPage} onChange={(event) => onInPage(event.target.checked)} />
      </label>
    </section>
  )
}
