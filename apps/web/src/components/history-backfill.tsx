import { useCallback, useEffect, useState } from "react"
import { Check, Database, Pause, Play, RefreshCw, Square } from "lucide-react"

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
  outbound_actions: "Your likes, restacks + replies",
  owned_notes: "Your Notes + replies",
  owned_posts: "Your posts + comments",
  subscribers: "Subscribers to you",
  followers: "People who follow you",
  following: "People you follow + subscriptions",
  missing_handles: "People missing handles",
}

const streamOptions = [
  { id: "activity", description: "Notifications and inbound activity", history: true },
  { id: "outbound_actions", description: "Your outbound engagement", history: true },
  { id: "owned_notes", description: "Notes and their conversations", history: true },
  { id: "owned_posts", description: "Posts and their comments", history: true },
  { id: "subscribers", description: "Who subscribes to your publication", history: false },
  { id: "followers", description: "Who follows your Substack profile", history: false },
  { id: "following", description: "Who you follow and subscribe to", history: false },
  { id: "missing_handles", description: "Recover handles from stable profile IDs", history: false },
] as const

export function HistoryBackfill() {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedTimeframe, setSelectedTimeframe] = useState<number | "custom">(90)
  const [customDate, setCustomDate] = useState("")
  const [selectedStreams, setSelectedStreams] = useState<string[]>(
    streamOptions.filter((stream) => stream.history).map((stream) => stream.id)
  )

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
  }, [open, load])

  const hasHistory = streamOptions.some((stream) =>
    stream.history && selectedStreams.includes(stream.id)
  )

  function toggleStream(stream: string) {
    setSelectedStreams((current) => current.includes(stream)
      ? current.filter((item) => item !== stream)
      : [...current, stream])
  }

  async function startBackfill() {
    setBusy(true)
    setError(null)
    try {
      if (selectedStreams.length === 0) throw new Error("Select at least one data source")
      const payload: Record<string, unknown> = { full: false, streams: selectedStreams }
      if (hasHistory && selectedTimeframe === "custom") {
        if (!customDate) throw new Error("Please select a cutoff date")
        payload.cutoffDate = customDate
      } else if (hasHistory) {
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
        <Button variant="outline" size="sm" className="h-8 rounded text-xs font-medium border-stone-200 dark:border-stone-800">
          <Database className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">History &amp; Sync</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col h-full bg-stone-50 dark:bg-stone-950 overflow-hidden border-l border-stone-200 dark:border-stone-800">
        <SheetHeader className="p-4 pb-3 border-b border-stone-200/80 bg-white/80 dark:bg-stone-900/80 dark:border-stone-800">
          <SheetTitle className="text-base font-bold text-stone-900 dark:text-stone-100">
            Substack History &amp; Audience Sync
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground mt-0.5">
            Backfill interactions, sync your publication subscribers, and keep your relationship graph complete.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
          {/* Unified backfill setup */}
          <div className="rounded border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900 space-y-2.5 shadow-none">
            <div>
              <p className="text-xs font-bold text-stone-900 dark:text-stone-100">Choose what to backfill</p>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Select any combination. Each source runs independently in the background.
              </p>
            </div>

            {/* 1-column layout for backfill streams with multiple rows */}
            <div className="flex flex-col gap-1.5">
              {streamOptions.map((stream) => {
                const selected = selectedStreams.includes(stream.id)
                return (
                  <button
                    key={stream.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleStream(stream.id)}
                    className={`flex items-start gap-2.5 rounded border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-stone-900 bg-stone-50/90 dark:border-stone-200 dark:bg-stone-800"
                        : "border-stone-200/90 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border ${
                        selected
                          ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                          : "border-stone-300 dark:border-stone-600"
                      }`}
                    >
                      {selected && <Check className="size-2.5" />}
                    </span>
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-stone-900 dark:text-stone-100 leading-snug">
                        {streamNames[stream.id]}
                      </span>
                      <span className="text-[11px] text-stone-500 leading-snug">
                        {stream.description}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="flex gap-3 text-[11px] font-medium pt-0.5">
              <button
                type="button"
                onClick={() => setSelectedStreams(streamOptions.map((stream) => stream.id))}
                className="text-stone-700 hover:underline dark:text-stone-300"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelectedStreams([])}
                className="text-stone-500 hover:underline"
              >
                Clear
              </button>
            </div>

            <div className={`space-y-1.5 border-t border-stone-100 pt-2.5 dark:border-stone-800 ${hasHistory ? "" : "opacity-45"}`}>
              <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                History timeframe
              </span>
              <div className="flex flex-wrap gap-1">
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
                      disabled={!hasHistory}
                      onClick={() => setSelectedTimeframe(item.value as any)}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
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
                <div className="pt-1 flex items-center gap-2">
                  <span className="text-xs text-stone-500 shrink-0">Cutoff:</span>
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    disabled={!hasHistory}
                    className="h-7 px-2 text-xs rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                  />
                  <span className="text-[11px] text-stone-400">Audience sweeps always use current state.</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={startBackfill}
                disabled={busy || selectedStreams.length === 0 || latest?.status === "running" || (hasHistory && selectedTimeframe === "custom" && !customDate)}
                size="sm"
                className="text-xs h-7.5 rounded px-3 bg-[#191817] hover:bg-[#302e2c] text-white"
              >
                {busy ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <Database className="mr-1.5 size-3.5" />}
                Start selected{hasHistory ? ` (${timeframeLabel})` : ""}
              </Button>
              {latest?.status === "running" && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => changeRun(latest, "pause")} className="text-xs h-7.5 rounded px-2.5">
                  <Pause className="mr-1.5 size-3.5" /> Pause
                </Button>
              )}
              {latest?.status === "paused" && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => changeRun(latest, "resume")} className="text-xs h-7.5 rounded px-2.5">
                  <Play className="mr-1.5 size-3.5" /> Resume
                </Button>
              )}
              {(latest?.status === "running" || latest?.status === "paused") && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => changeRun(latest, "cancel")} className="text-xs h-7.5 rounded px-2.5 text-red-600 hover:text-red-700 dark:text-red-400">
                  <Square className="mr-1.5 size-3.5" /> Stop
                </Button>
              )}
            </div>
          </div>

          {error && <p className="rounded bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

          {latest ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold capitalize text-stone-900 dark:text-stone-100">Latest run: {latest.status}</p>
                  <p className="text-[11px] text-stone-500">{new Date(latest.startedAt).toLocaleString()}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => void load()} title="Refresh status" className="size-7 rounded">
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>

              {latest.streams.map((stream) => (
                <div key={stream.stream} className="rounded border border-stone-200/80 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900 shadow-none">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">{streamNames[stream.stream] ?? stream.stream}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${
                      stream.status === "complete" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" :
                      stream.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" :
                      stream.status === "unavailable" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" :
                      "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                    }`}>{stream.status}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-stone-500">
                    {stream.stream === "subscribers"
                      ? `${stream.items} subscribers checked · ${stream.newPeople} new people`
                      : stream.stream === "followers"
                        ? `${stream.items} followers imported · ${stream.newPeople} new people`
                        : stream.stream === "following"
                          ? `${stream.items} contacts checked`
                        : stream.stream === "missing_handles"
                          ? `${stream.items} contacts checked · ${stream.newPeople} handles recovered`
                        : `${stream.items} items · ${stream.newInteractions} new interactions · ${stream.newPeople} people`}
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
