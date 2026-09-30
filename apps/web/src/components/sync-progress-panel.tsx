import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

type SyncStep = {
  id: string
  type: string
  stream: string | null
  outboundStage: string | null
  status: "pending" | "running" | "done" | "failed" | "dead"
  attempts: number
  maxAttempts: number
  runAt: string
  startedAt: string | null
  createdAt: string
  updatedAt: string
  result: Record<string, number | boolean> | null
  error: string | null
}

type SyncProgress = {
  run: { id: string; status: "running" | "complete" | "failed"; startedAt: string; steps: SyncStep[] } | null
  lastSyncedAt: string | null
}

const countLabels: Record<string, string> = {
  processedItems: "activity items",
  items: "items",
  newInteractions: "new interactions",
  newPeople: "new people",
  processed: "subscribers checked",
  matched: "matched",
  created: "new contacts",
  invalid: "skipped",
  deactivated: "unsubscribed",
  checked: "checked",
  updated: "updated",
  failed: "unverifiable",
  subscribed: "subscriptions",
}

function stepName(step: SyncStep): string {
  if (step.type === "sync:activity") return "Activity feed"
  if (step.type === "sync:subscribers") return "Subscribers"
  if (step.type === "sync:followers") return "Followers"
  if (step.type === "sync:following") return "Following and subscriptions"
  if (step.stream === "owned_notes") return "Your Notes and replies"
  if (step.stream === "owned_posts") return "Your posts and comments"
  if (step.stream === "outbound_actions") {
    return step.outboundStage
      ? `Your ${step.outboundStage}`
      : "Your likes, restacks and replies"
  }
  return "Sync step"
}

function timestamp(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString()
}

function stepDetail(step: SyncStep): string {
  if (step.result?.skipped === true) return "Skipped because the connection was inactive"
  const counts = Object.entries(step.result ?? {})
    .filter(([key, value]) => key in countLabels && typeof value === "number")
    .map(([key, value]) => `${value} ${countLabels[key]}`)
  if (counts.length > 0) return counts.join(" · ")
  if (step.status === "pending" && step.error) return `Retry queued · ${step.error}`
  if (step.status === "pending") return `Queued for ${timestamp(step.runAt)}`
  if (step.status === "running") return "Working on this step now"
  if (step.status === "dead" || step.status === "failed") return step.error ?? "This step failed"
  return "Finished"
}

export function SyncProgressPanel({
  open,
  onOpenChange,
  refreshKey,
  feedback,
  isRequesting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  refreshKey: number
  feedback: string | null
  isRequesting: boolean
}) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/sync/progress", { cache: "no-store" })
    if (!response.ok) throw new Error("Could not load sync progress")
    setProgress(await response.json() as SyncProgress)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) return
    void load().catch((reason) => setError(reason.message))
    const timer = window.setInterval(() => void load().catch((reason) => setError(reason.message)), 3_000)
    return () => window.clearInterval(timer)
  }, [open, refreshKey, load])

  async function refresh() {
    setLoading(true)
    try { await load() } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load sync progress")
    } finally { setLoading(false) }
  }

  const run = progress?.run
  const active = run?.status === "running"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full flex-col overflow-hidden border-l border-stone-200 bg-stone-50 p-0 dark:border-stone-800 dark:bg-stone-950 sm:max-w-lg">
        <SheetHeader className="border-b border-stone-200/80 bg-white/80 p-4 pb-3 dark:border-stone-800 dark:bg-stone-900/80">
          <SheetTitle className="text-base font-bold">Latest Substack sync</SheetTitle>
          <SheetDescription className="text-xs">
            Live progress from the background queue. Steps update every few seconds while this panel is open.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
          {feedback && (
            <p className="rounded border border-sky-200 bg-sky-50 p-2.5 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              {isRequesting && <LoaderCircle className="mr-1.5 inline size-3 animate-spin" />}
              {feedback}
            </p>
          )}
          {error && <p className="rounded bg-red-50 p-2.5 text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

          <div className="rounded border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-stone-900 dark:text-stone-100">
                  {run ? run.status === "complete" ? "Sync finished" : run.status === "failed" ? "Sync needs attention" : "Sync in progress" : "No recent sync run"}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-500">
                  {run ? `Started ${timestamp(run.startedAt)}` : "Press Sync to start a refresh."}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} title="Refresh progress" className="size-7 rounded">
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <p className="mt-2 border-t border-stone-100 pt-2 text-[11px] text-stone-500 dark:border-stone-800">
              Latest activity page synced: {timestamp(progress?.lastSyncedAt ?? null)}
            </p>
          </div>

          {run && (
            <div className="space-y-2" aria-live="polite">
              <p className="font-semibold text-stone-700 dark:text-stone-300">Backend activity</p>
              {run.steps.map((step) => (
                <div key={step.id} className="flex gap-2.5 rounded border border-stone-200/80 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
                  {step.status === "done" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    : step.status === "dead" || step.status === "failed" ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-red-600" />
                      : step.status === "running" ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-sky-600" />
                        : <Clock3 className="mt-0.5 size-3.5 shrink-0 text-stone-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-stone-900 dark:text-stone-100">{stepName(step)}</p>
                      <span className="shrink-0 capitalize text-[10px] text-stone-500">{step.status === "dead" ? "failed" : step.status}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-stone-500">{stepDetail(step)}</p>
                    <p className="mt-1 text-[10px] text-stone-400">{timestamp(step.status === "pending" ? step.runAt : step.updatedAt)}</p>
                  </div>
                </div>
              ))}
              {!active && <p className="text-[11px] text-stone-500">This run has stopped. The next scheduled sync will appear here when it starts.</p>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
