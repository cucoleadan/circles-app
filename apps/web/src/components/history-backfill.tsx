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

  const [selectedTimeframe, setSelectedTimeframe] = useState<number | "custom">(90)
  const [customDate, setCustomDate] = useState("")
  const [syncSubsBusy, setSyncSubsBusy] = useState(false)
  const [syncSubsMsg, setSyncSubsMsg] = useState<string | null>(null)
  const [syncFollowersBusy, setSyncFollowersBusy] = useState(false)
  const [syncFollowersMsg, setSyncFollowersMsg] = useState<string | null>(null)

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
      const payload: Record<string, unknown> = { full: false }
      if (selectedTimeframe === "custom") {
        if (!customDate) throw new Error("Please select a cutoff date")
        payload.cutoffDate = customDate
      } else {
        payload.days = selectedTimeframe
      }

      const response = await fetch("/api/v1/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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

  async function syncSubscribers() {
    setSyncSubsBusy(true)
    setSyncSubsMsg(null)
    setError(null)
    try {
      const res = await fetch("/api/v1/sync/subscribers", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to sync subscribers")
      setSyncSubsMsg(`Synced ${data.totalSubscribers} subscribers (${data.matched} matched, ${data.created} new contacts)`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncSubsBusy(false)
    }
  }

  async function syncFollowers() {
    setSyncFollowersBusy(true)
    setSyncFollowersMsg(null)
    setError(null)
    try {
      const res = await fetch("/api/v1/sync/followers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to check followers")
      setSyncFollowersMsg(`Checked ${data.checked} contacts: found ${data.followersCount} followers`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncFollowersBusy(false)
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
  const timeframeLabel =
    selectedTimeframe === 7 ? "1 week" :
    selectedTimeframe === 14 ? "2 weeks" :
    selectedTimeframe === 30 ? "1 month" :
    selectedTimeframe === 60 ? "2 months" :
    selectedTimeframe === 90 ? "3 months" :
    customDate ? `Since ${customDate}` : "Custom date"

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8.5 rounded-full text-xs font-medium border-stone-200">
          <Database className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">History &amp; Sync</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg gap-0 overflow-y-auto bg-stone-50 dark:bg-stone-950">
        <SheetHeader className="border-b border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
          <SheetTitle>Substack History &amp; Audience Sync</SheetTitle>
          <SheetDescription>
            Backfill interactions, sync your publication subscribers, and keep your relationship graph complete.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-6">
          {/* Audience Sync Section */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 space-y-3">
            <div>
              <p className="text-xs font-bold text-stone-900 dark:text-stone-100">Publication Audience</p>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Import all subscribers from your publication and check follower status on Substack.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={syncSubscribers}
                disabled={syncSubsBusy}
                className="text-xs h-8"
              >
                {syncSubsBusy ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <Database className="mr-1.5 size-3.5" />}
                Sync Subscribers
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={syncFollowers}
                disabled={syncFollowersBusy}
                className="text-xs h-8"
              >
                {syncFollowersBusy ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
                Check Follower Status
              </Button>
            </div>
            {syncSubsMsg && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{syncSubsMsg}</p>
            )}
            {syncFollowersMsg && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{syncFollowersMsg}</p>
            )}
          </div>

          {/* Timeframe Backfill Section */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 space-y-3">
            <div>
              <p className="text-xs font-bold text-stone-900 dark:text-stone-100">Interaction History Backfill</p>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Choose a specific timeframe to import past activity, notes, comments, and restacks.
              </p>
            </div>

            {/* Timeframe selector pills */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">Timeframe:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "1 week", value: 7 },
                  { label: "2 weeks", value: 14 },
                  { label: "1 month", value: 30 },
                  { label: "2 months", value: 60 },
                  { label: "3 months", value: 90 },
                  { label: "Custom date", value: "custom" },
                ].map((item) => {
                  const isSel = selectedTimeframe === item.value
                  return (
                    <button
                      key={String(item.value)}
                      type="button"
                      onClick={() => setSelectedTimeframe(item.value as any)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        isSel
                          ? "bg-[#191817] text-white shadow-2xs dark:bg-stone-100 dark:text-stone-900 font-semibold"
                          : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300"
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>

              {selectedTimeframe === "custom" && (
                <div className="pt-1.5 flex items-center gap-2">
                  <span className="text-xs text-stone-500 shrink-0">Cutoff:</span>
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    className="h-7 px-2 text-xs rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                  />
                  <span className="text-[11px] text-stone-400">(Imports activity back to this date)</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={startBackfill}
                disabled={busy || latest?.status === "running" || (selectedTimeframe === "custom" && !customDate)}
                size="sm"
                className="text-xs"
              >
                {busy ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <Database className="mr-1.5 size-3.5" />}
                Backfill ({timeframeLabel})
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
