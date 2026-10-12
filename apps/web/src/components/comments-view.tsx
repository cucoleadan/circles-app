import { useEffect, useMemo, useState } from "react"
import { CalendarDays, ExternalLink, EyeOff, Heart, Loader2, MessageSquare, RefreshCw, Undo2 } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Card, CardContent, CardFooter, CardHeader } from "@workspace/ui/components/card"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { commentDateWindow } from "../lib/comments"
import { profileUrlForPerson } from "../lib/profile-url"
import { initials } from "./contact-card/contact-card-badges"
import { contentUrl, formatDate } from "./timeline/timeline-item"

interface ReceivedComment {
  id: string
  personId: string
  commentId: string
  body: string | null
  occurredAt: string
  authorName: string
  authorHandle: string | null
  authorAvatar: string | null
  contentKind: "note" | "post"
  contentTitle: string | null
  contentBody: string | null
  contentUrl: string | null
  replied: boolean
  liked: boolean
  notInterested: boolean
}

export function CommentsView({ search, refreshKey }: { search: string; refreshKey: number }) {
  const [comments, setComments] = useState<ReceivedComment[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState("all")
  const [kind, setKind] = useState("all")
  const [excludeResponded, setExcludeResponded] = useState(false)
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to?: Date }>()
  const [dateOpen, setDateOpen] = useState(false)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dateWindow = useMemo(() => commentDateWindow(dateRange?.from, dateRange?.to), [dateRange, reload, refreshKey])
  const query = new URLSearchParams({ search: search.trim(), status, kind, excludeResponded: String(excludeResponded), ...dateWindow, limit: "50" }).toString()

  useEffect(() => {
    const refresh = () => setReload((key) => key + 1)
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setComments([])
    setNextCursor(null)
    fetch(`/api/v1/comments?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load comments. Try refreshing.")
        return res.json()
      })
      .then((data) => {
        setComments(data.comments)
        setNextCursor(data.nextCursor)
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, reload, refreshKey])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/comments?${query}&cursor=${encodeURIComponent(nextCursor)}`)
      if (!res.ok) throw new Error("Could not load older comments. Try again.")
      const data = await res.json()
      setComments((previous) => [...previous, ...data.comments])
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load older comments.")
    } finally {
      setLoadingMore(false)
    }
  }

  async function toggleNotInterested(comment: ReceivedComment) {
    if (saving) return
    setSaving(comment.id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/comments/${encodeURIComponent(comment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notInterested: !comment.notInterested }),
      })
      if (!res.ok) throw new Error("Could not save this choice. Try again.")
      setComments((previous) => previous.flatMap((item) => {
        if (item.id !== comment.id) return [item]
        const updated = { ...item, notInterested: !item.notInterested }
        if ((status === "pending" && updated.notInterested) ||
            (status === "not-interested" && !updated.notInterested)) return []
        return [updated]
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this choice.")
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Comments</h2>
          <p className="mt-1 text-xs text-muted-foreground">Comments and direct replies received on your Notes and articles, newest first.</p>
        </div>
        <Button variant="outline" size="sm" disabled={loading || loadingMore || Boolean(saving)} onClick={() => setReload((key) => key + 1)}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" aria-label="Comment dates" disabled={loadingMore || Boolean(saving)}>
              <CalendarDays className="size-4" />
              {dateRange?.from
                ? `${dateRange.from.toLocaleDateString()}${dateRange.to ? ` – ${dateRange.to.toLocaleDateString()}` : ""}`
                : "Last 48 hours"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar mode="range" selected={dateRange} onSelect={setDateRange} defaultMonth={dateRange?.from} disabled={{ after: new Date() }} />
            <div className="flex justify-between gap-2 border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => {
                setDateRange(undefined)
                setReload((key) => key + 1)
                setDateOpen(false)
              }}>Last 48 hours</Button>
              <Button size="sm" onClick={() => setDateOpen(false)}>Done</Button>
            </div>
          </PopoverContent>
        </Popover>
        <Select value={status} onValueChange={setStatus} disabled={loadingMore || Boolean(saving)}>
          <SelectTrigger aria-label="Comment status" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All comments</SelectItem>
            <SelectItem value="pending">Needs attention</SelectItem>
            <SelectItem value="not-interested">Not interested</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind} disabled={loadingMore || Boolean(saving)}>
          <SelectTrigger aria-label="Content type" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Notes &amp; articles</SelectItem>
            <SelectItem value="note">Notes</SelectItem>
            <SelectItem value="post">Articles</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={excludeResponded ? "default" : "outline"}
          aria-pressed={excludeResponded}
          disabled={loadingMore || Boolean(saving)}
          onClick={() => setExcludeResponded((value) => !value)}
        >
          Exclude liked/replied
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Showing synced comments. Replied and Liked reflect recorded actions on that comment; older actions may be missing. Not interested applies only to this comment.</p>
      {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {loading ? (
        <div role="status" aria-label="Loading comments" className="space-y-3">
          {[1, 2, 3].map((id) => <Skeleton key={id} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : comments.length === 0 && !error ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          {status === "pending" ? "No synced comments need attention." : status === "not-interested" ? "No comments marked not interested." : "No synced comments match this view."}
        </CardContent></Card>
      ) : comments.map((comment) => {
        const authorUrl = profileUrlForPerson({ profileUrl: null, handle: comment.authorHandle })
        const threadUrl = contentUrl(comment.contentUrl)
        return (
          <Card key={comment.id} size="sm" className={comment.notInterested ? "bg-stone-100/70 dark:bg-stone-900/70" : ""}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="size-9">
                    <AvatarImage src={comment.authorAvatar ?? undefined} alt="" referrerPolicy="no-referrer" />
                    <AvatarFallback>{initials(comment.authorName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    {authorUrl ? <a href={authorUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{comment.authorName}</a> : <span className="font-semibold">{comment.authorName}</span>}
                    {comment.authorHandle && <p className="truncate text-xs text-muted-foreground">@{comment.authorHandle.replace(/^@/, "")}</p>}
                  </div>
                </div>
                <time dateTime={comment.occurredAt} title={new Date(comment.occurredAt).toLocaleString()} className="text-xs text-muted-foreground">{formatDate(comment.occurredAt)}</time>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline">{comment.contentKind === "note" ? "Note" : "Article"}</Badge>
                {comment.replied && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><MessageSquare className="size-3" /> Replied</Badge>}
                {comment.liked && <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"><Heart className="size-3" /> Liked</Badge>}
                {comment.notInterested && <Badge variant="secondary"><EyeOff className="size-3" /> Not interested</Badge>}
                {!comment.replied && !comment.liked && !comment.notInterested && <Badge variant="outline">No response recorded</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{comment.body || "Comment text is unavailable in the synced data."}</p>
              <div className="border-l-2 border-stone-200 pl-3 dark:border-stone-700">
                <p className="text-[11px] font-medium text-muted-foreground">On your {comment.contentKind === "note" ? "Note" : "article"}</p>
                {threadUrl ? (
                  <a href={threadUrl} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground hover:text-foreground hover:underline">
                    {comment.contentTitle || comment.contentBody || "Untitled"}
                  </a>
                ) : <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{comment.contentTitle || comment.contentBody || "Untitled"}</p>}
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap justify-between gap-2">
              {threadUrl ? <Button asChild variant="outline" size="sm"><a href={threadUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /> Open {comment.contentKind === "note" ? "Note" : "article"} on Substack</a></Button> : <span className="text-xs text-muted-foreground">Substack link unavailable</span>}
              <Button variant="ghost" size="sm" aria-pressed={comment.notInterested} disabled={Boolean(saving) || loadingMore} onClick={() => void toggleNotInterested(comment)}>
                {saving === comment.id ? <Loader2 className="size-3.5 animate-spin" /> : comment.notInterested ? <Undo2 className="size-3.5" /> : <EyeOff className="size-3.5" />}
                {comment.notInterested ? "Undo not interested" : "Not interested"}
              </Button>
            </CardFooter>
          </Card>
        )
      })}
      {!loading && nextCursor && <div className="text-center"><Button variant="outline" disabled={loadingMore || Boolean(saving)} onClick={() => void loadMore()}>{loadingMore && <Loader2 className="size-3.5 animate-spin" />}{loadingMore ? "Loading…" : "Load older comments"}</Button></div>}
    </div>
  )
}
