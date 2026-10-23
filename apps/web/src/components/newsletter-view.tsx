import { useEffect, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { formatDate } from "./timeline/timeline-item"

interface ExportRun {
  id: string
  status: "running" | "complete" | "failed"
  stage: string | null
  error: string | null
  createdAt: string
}

interface NewsletterSignals {
  run: ExportRun | null
  calculatedAt: string | null
  coldAfterSends: number
  summary: { subscribers: number; listed: number; neverOpened: number; goingCold: number; averageOpenRate: number | null } | null
  posts: Array<{ postId: string; title: string | null; sentAt: string | null; delivered: number; opened: number; openRate: number | null }>
  subscribers: Array<{
    email: string
    inEmailList: boolean
    plan: string | null
    delivered: number
    opened: number
    openRate: number | null
    lastOpenedAt: string | null
    sendsSinceOpen: number
  }>
}

const percent = (value: number | null) => value === null ? "–" : `${Math.round(value * 100)}%`

export function NewsletterView({ search }: { search: string }) {
  const [data, setData] = useState<NewsletterSignals | null>(null)
  const [filter, setFilter] = useState("engaged")
  const [reload, setReload] = useState(0)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = data?.run?.status === "running"
  const query = new URLSearchParams({ filter, ...(search.trim() && { search: search.trim() }) }).toString()

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/v1/newsletter/signals?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load newsletter signals. Try refreshing.")
        setData(await res.json())
        setError(null)
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [query, reload])

  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => setReload((key) => key + 1), 5000)
    return () => clearTimeout(timer)
  }, [running, data])

  async function startExport() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/newsletter/exports", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Could not start the export. Try again.")
      setReload((key) => key + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the export.")
    } finally {
      setStarting(false)
    }
  }

  const summary = data?.summary
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Newsletter Signals</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Email opens per post and per subscriber, calculated from your Substack publication export.
            {data?.calculatedAt && ` Last calculated ${formatDate(data.calculatedAt)}.`}
          </p>
        </div>
        <Button size="sm" disabled={!data || running || starting} onClick={() => void startExport()}>
          {running || starting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {running ? data?.run?.stage || "Exporting…" : "Request new export"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Each request creates a new export in your Substack dashboard and replaces these numbers; it usually takes a few minutes.
        Opens include automatic opens by some mail apps, so rates can read high. Circles keeps only email, plan and send/open counts.
      </p>
      {data?.run?.status === "failed" && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">The last export failed: {data.run.error || "unknown error"}</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!data ? (
        <div role="status" aria-label="Loading newsletter signals" className="space-y-3">
          {[1, 2].map((id) => <Skeleton key={id} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : !summary ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          {running ? "Substack is preparing your export…" : "No signals yet. Request an export to calculate them."}
        </CardContent></Card>
      ) : <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Average open rate", percent(summary.averageOpenRate)],
            ["On email list", summary.listed.toLocaleString()],
            ["Going cold", summary.goingCold.toLocaleString()],
            ["Never opened", summary.neverOpened.toLocaleString()],
          ].map(([label, value]) => (
            <Card key={label} size="sm"><CardContent>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold tabular-nums">{value}</p>
            </CardContent></Card>
          ))}
        </div>

        <Card size="sm">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Subscribers</h3>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger aria-label="Subscriber filter" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="engaged">Most engaged</SelectItem>
                <SelectItem value="cold">Going cold ({data.coldAfterSends}+ sends unopened)</SelectItem>
                <SelectItem value="never">Never opened</SelectItem>
                <SelectItem value="all">Everyone</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1.5 pr-3 font-medium">Email</th><th className="pr-3 font-medium">Open rate</th><th className="pr-3 font-medium">Opened</th><th className="pr-3 font-medium">Last open</th><th className="font-medium">Unopened since</th></tr>
              </thead>
              <tbody>
                {data.subscribers.length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No subscribers match this view.</td></tr>
                ) : data.subscribers.map((subscriber) => (
                  <tr key={subscriber.email} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="max-w-64 truncate py-1.5 pr-3">
                      {subscriber.email}
                      {!subscriber.inEmailList && <Badge variant="outline" className="ml-2">Left list</Badge>}
                      {subscriber.plan && subscriber.plan !== "other" && <Badge variant="secondary" className="ml-2">{subscriber.plan}</Badge>}
                    </td>
                    <td className="pr-3 tabular-nums">{percent(subscriber.openRate)}</td>
                    <td className="pr-3 tabular-nums">{subscriber.opened}/{subscriber.delivered}</td>
                    <td className="pr-3">{subscriber.lastOpenedAt ? formatDate(subscriber.lastOpenedAt) : "Never"}</td>
                    <td className="tabular-nums">{subscriber.sendsSinceOpen} sends</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader><h3 className="font-semibold">Posts</h3></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1.5 pr-3 font-medium">Post</th><th className="pr-3 font-medium">Sent</th><th className="pr-3 font-medium">Delivered</th><th className="pr-3 font-medium">Opened</th><th className="font-medium">Open rate</th></tr>
              </thead>
              <tbody>
                {data.posts.map((post) => (
                  <tr key={post.postId} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="max-w-80 truncate py-1.5 pr-3">{post.title || "Untitled"}</td>
                    <td className="pr-3">{post.sentAt ? formatDate(post.sentAt) : "–"}</td>
                    <td className="pr-3 tabular-nums">{post.delivered.toLocaleString()}</td>
                    <td className="pr-3 tabular-nums">{post.opened.toLocaleString()}</td>
                    <td className="tabular-nums">{percent(post.openRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </>}
    </div>
  )
}
