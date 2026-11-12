import { useEffect, useState } from "react"
import { ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import type { ListRecord, Person } from "../lib/types"

type ContentKind = "note" | "reply" | "restack" | "post"
type ContentFilter = "all" | ContentKind

interface ContentItem {
  id: string
  kind: ContentKind
  title: string | null
  body: string | null
  url: string | null
  publishedAt: string
}

interface ContentFreshness {
  notesFetchedAt: string | null
  notesError: string | null
  postsFetchedAt: string | null
  postsError: string | null
}

const FILTERS: Array<{ id: ContentFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "note", label: "Notes" },
  { id: "post", label: "Posts" },
  { id: "restack", label: "Restacks" },
  { id: "reply", label: "Replies" },
]

const KIND_LABEL: Record<ContentKind, string> = { note: "Note", reply: "Reply", restack: "Restack", post: "Post" }
const KIND_STYLE: Record<ContentKind, string> = {
  note: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  post: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  restack: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  reply: "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

/** The contact's stored Notes, replies, restacks and posts, and whether Circles keeps them fresh. */
export function ContactContentTab({
  person,
  allLists,
  onPersonUpdated,
}: {
  person: Person
  allLists: ListRecord[]
  onPersonUpdated: (updated: Person) => void
}) {
  const [items, setItems] = useState<ContentItem[]>([])
  const [freshness, setFreshness] = useState<ContentFreshness | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<ContentFilter>("all")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  const watchedList = allLists.find((list) => list.systemKey === "watched")
  const watched = Boolean(watchedList && (person.lists ?? []).some((list) => list.id === watchedList.id))

  async function load(cursor?: string) {
    const query = new URLSearchParams({ personId: person.id, kind: filter, limit: "30" })
    if (cursor) query.set("cursor", cursor)
    const response = await fetch(`/api/v1/profile-content?${query}`)
    if (!response.ok) throw new Error("Could not load this contact's Notes and posts")
    return response.json() as Promise<{ items: ContentItem[]; nextCursor: string | null; profiles: ContentFreshness[] }>
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setItems([])
    load()
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setNextCursor(data.nextCursor)
        setFreshness(data.profiles[0] ?? null)
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load content") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, filter])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await load(nextCursor)
      setItems((current) => [...current, ...data.items])
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more")
    } finally {
      setLoadingMore(false)
    }
  }

  async function toggleWatched() {
    if (!watchedList || toggling) return
    setToggling(true)
    setError(null)
    try {
      const response = watched
        ? await fetch(`/api/v1/lists/${watchedList.id}/members/${person.id}`, { method: "DELETE" })
        : await fetch(`/api/v1/lists/${watchedList.id}/members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ personId: person.id }),
          })
      if (!response.ok) throw new Error("Could not update Watched Profiles")
      const lists = person.lists ?? []
      onPersonUpdated({
        ...person,
        lists: watched
          ? lists.filter((list) => list.id !== watchedList.id)
          : [...lists, { id: watchedList.id, name: watchedList.name, createdAt: new Date().toISOString() }],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Watched Profiles")
    } finally {
      setToggling(false)
    }
  }

  const hasIdentity = Boolean(person.substackProfileId)
  const status = !hasIdentity
    ? "This contact has no Substack profile ID, so Circles cannot read their Notes."
    : watched
      ? freshness?.notesFetchedAt
        ? `Notes read ${dateTime(freshness.notesFetchedAt)}${freshness.postsFetchedAt ? ` · posts read ${dateTime(freshness.postsFetchedAt)}` : ""}`
        : "Watched. The first read usually happens within a few minutes."
      : freshness?.notesFetchedAt
        ? `Not watched. Last read ${dateTime(freshness.notesFetchedAt)}; this copy is not kept fresh.`
        : "Not watched. Watch this contact to keep their Notes and posts here."
  const problem = watched ? freshness?.notesError ?? freshness?.postsError : null

  return (
    <div className="space-y-2.5">
      <div className="rounded border border-stone-200/80 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-bold text-stone-900 dark:text-stone-100">
            {watched ? "On Watched Profiles" : "Notes & posts"}
          </p>
          <p className="text-[11px] text-stone-500 dark:text-stone-400">{status}</p>
          {problem && <p className="text-[11px] text-rose-600 dark:text-rose-400">Last attempt: {problem}</p>}
        </div>
        {watchedList && hasIdentity && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={toggling}
            onClick={toggleWatched}
            className="h-7 shrink-0 px-2.5 text-xs rounded"
          >
            {watched ? <EyeOff className="size-3.5 mr-1" /> : <Eye className="size-3.5 mr-1" />}
            {watched ? "Stop watching" : "Watch"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold border transition-colors ${
              filter === option.id
                ? "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100"
                : "bg-white text-stone-600 border-stone-200 hover:border-stone-300 dark:bg-stone-900 dark:text-stone-400 dark:border-stone-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded border border-dashed border-stone-200 p-5 text-center text-xs text-muted-foreground dark:border-stone-800">
          {filter === "all" ? "Nothing stored for this contact yet." : "Nothing of this kind stored yet."}
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded border border-stone-200/80 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`rounded border px-1.5 text-[9.5px] font-bold ${KIND_STYLE[item.kind]}`}>
                    {KIND_LABEL[item.kind]}
                  </span>
                  <span className="text-[10.5px] text-stone-400 dark:text-stone-500">{dateTime(item.publishedAt)}</span>
                </div>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-semibold text-stone-500 hover:text-[#f15a3a]"
                  >
                    Open <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              {item.title && (
                <p className="text-xs font-bold text-stone-900 dark:text-stone-100 break-words">{item.title}</p>
              )}
              {item.body && (
                <p className="text-xs leading-relaxed text-stone-700 dark:text-stone-300 whitespace-pre-line break-words line-clamp-6">
                  {item.body}
                </p>
              )}
            </article>
          ))}
          {nextCursor && (
            <div className="flex justify-center pt-1">
              <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={loadMore} className="h-7 text-xs px-3 rounded">
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
