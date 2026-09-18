import { useCallback, useEffect, useState } from "react"
import { Database, Pause, Play, RefreshCw, Square } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"

type ImportStream = {
  stream: string
  status: string
  pages: number
  items: number
  newInteractions: number
  newPeople: number
  completeness: string
  finishReason: string | null
  error: string | null
}

type ImportRun = {
  id: string
  status: string
  startedAt: string
  items: number
  newInteractions: number
  newPeople: number
  finishReason: string | null
  error: string | null
  streams: ImportStream[]
}

const streamNames: Record<string, string> = {
  activity: "Activity feed",
  owned_notes: "Your Notes + replies",
  owned_posts: "Your posts + comments",
  outbound_actions: "Your likes, restacks + replies",
}

export function HistoryBackfill() {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/imports")
    if (!response.ok) throw new Error("Could not load backfill status")
    const data = await response.json()
    setRuns(data.imports ?? [])
  }, [])

  useEffect(() => {
    if (!open) return
    void load().catch((err) => setError(err.message))
    const timer = window.setInterval(() => void load().catch(() => {}), 3_000)
    return () => window.clearInterval(timer)
  }, [open, runs, load])

  async function startBackfill() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/v1/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ full: false, months: 3 }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || "Could not start the backfill")
      }
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function changeRun(run: ImportRun, action: "pause" | "resume" | "cancel") {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/imports/${run.id}/${action}`, { method: "POST" })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Could not ${action} the backfill`)
      }
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const latest = runs[0]
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8.5 rounded-full text-xs font-medium border-stone-200">
          <Database className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">History</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg gap-0 overflow-y-auto bg-stone-50 dark:bg-stone-950">
        <SheetHeader className="border-b border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
          <SheetTitle>Substack history (past 3 months)</SheetTitle>
          <SheetDescription>
            Backfill notifications, outbound activity, and authored Notes and posts for the past 3 months, then keep them current in normal syncs.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Substack exposes deep paginated history for active likes, active restacks, and comments or replies you authored. Removed likes and restacks may no longer appear in that history; the extension records future changes as they happen.
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={startBackfill} disabled={busy || latest?.status === "running"} size="sm" className="text-xs">
              {busy ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <Database className="mr-1.5 size-3.5" />}
              Backfill past 3 months
            </Button>
            {latest?.status === "running" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => changeRun(latest, "pause")} className="text-xs">
                <Pause className="mr-1.5 size-3.5" /> Pause
              </Button>
            )}
            {latest?.status === "paused" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => changeRun(latest, "resume")} className="text-xs">
                <Play className="mr-1.5 size-3.5" /> Resume
              </Button>
            )}
            {(latest?.status === "running" || latest?.status === "paused") && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => changeRun(latest, "cancel")} className="text-xs text-red-600 hover:text-red-700 dark:text-red-400">
                <Square className="mr-1.5 size-3.5" /> Stop
              </Button>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

          {latest ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold capitalize">Latest run: {latest.status}</p>
                  <p className="text-xs text-stone-500">{new Date(latest.startedAt).toLocaleString()}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => void load()} title="Refresh status">
                  <RefreshCw className="size-4" />
                </Button>
              </div>

              {latest.streams.map((stream) => (
                <div key={stream.stream} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold">{streamNames[stream.stream] ?? stream.stream}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      stream.status === "complete" ? "bg-emerald-100 text-emerald-700" :
                      stream.status === "failed" ? "bg-red-100 text-red-700" :
                      stream.status === "unavailable" ? "bg-amber-100 text-amber-800" :
                      "bg-sky-100 text-sky-700"
                    }`}>{stream.status}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-stone-500">
                    {stream.items} items · {stream.newInteractions} new interactions · {stream.newPeople} people
                  </p>
                  {stream.error && (
                    <p className="mt-1 text-[11px] text-stone-500">
                      {stream.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-stone-500">No history backfill has been run yet.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
