import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import type { Interaction } from "../lib/types"
import {
  actionBadge,
  formatDate,
  interactionLabel,
  targetLabel,
  TimelineItem,
} from "./timeline/timeline-item"

export { actionBadge, formatDate, interactionLabel, targetLabel }

type TimelineFilter = "all" | "comments" | "likes" | "restacks" | "inbound" | "outbound"

export function Timeline({
  personId,
  personName,
  refreshKey = 0,
}: {
  personId: string
  personName: string
  refreshKey?: number
}) {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<TimelineFilter>("all")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setInteractions([])

    fetch(`/api/v1/people/${personId}/interactions?limit=30`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load interactions")
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setInteractions(data.interactions ?? [])
        setNextCursor(data.nextCursor ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [personId, refreshKey])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/v1/people/${personId}/interactions?cursor=${encodeURIComponent(nextCursor)}&limit=30`
      )
      if (!res.ok) throw new Error("Failed to load more")
      const data = await res.json()
      setInteractions((prev) => [...prev, ...(data.interactions ?? [])])
      setNextCursor(data.nextCursor ?? null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const commentCount = useMemo(
    () => interactions.filter((i) => i.actionType === "comment" || i.actionType === "reply").length,
    [interactions]
  )
  const likeCount = useMemo(
    () => interactions.filter((i) => i.actionType === "like").length,
    [interactions]
  )
  const restackCount = useMemo(
    () => interactions.filter((i) => i.actionType === "restack").length,
    [interactions]
  )

  const filteredInteractions = useMemo(() => {
    return interactions.filter((item) => {
      if (filter === "comments") return item.actionType === "comment" || item.actionType === "reply"
      if (filter === "likes") return item.actionType === "like"
      if (filter === "restacks") return item.actionType === "restack"
      if (filter === "inbound") return item.direction === "inbound"
      if (filter === "outbound") return item.direction === "outbound"
      return true
    })
  }, [interactions, filter])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin mb-2 text-[#f15a3a]" />
        Loading interaction history…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive">
        {error}
      </div>
    )
  }

  if (interactions.length === 0) {
    return (
      <div className="rounded border border-dashed border-stone-200 p-5 text-center text-xs text-muted-foreground dark:border-stone-800">
        <p className="font-medium text-stone-700 dark:text-stone-300">No interaction history yet</p>
        <p className="mt-1 text-[11px]">
          When {personName} interacts on Substack or when you reach out, actions will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center gap-1 pb-1.5 border-b border-stone-100 dark:border-stone-800">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
            filter === "all"
              ? "bg-[#191817] text-white shadow-2xs font-semibold"
              : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300"
          }`}
        >
          All ({interactions.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("restacks")}
          className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
            filter === "restacks"
              ? "bg-[#191817] text-white shadow-2xs font-semibold"
              : "bg-violet-50 text-violet-800 hover:bg-violet-100 dark:bg-violet-950/50 dark:text-violet-300"
          }`}
        >
          🔁 Restacks ({restackCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("comments")}
          className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
            filter === "comments"
              ? "bg-[#191817] text-white shadow-2xs font-semibold"
              : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300"
          }`}
        >
          💬 Comments ({commentCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("likes")}
          className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
            filter === "likes"
              ? "bg-[#191817] text-white shadow-2xs font-semibold"
              : "bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300"
          }`}
        >
          ❤️ Likes ({likeCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("inbound")}
          className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
            filter === "inbound"
              ? "bg-[#191817] text-white shadow-2xs font-semibold"
              : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300"
          }`}
        >
          📥 Inbound
        </button>
        <button
          type="button"
          onClick={() => setFilter("outbound")}
          className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
            filter === "outbound"
              ? "bg-[#191817] text-white shadow-2xs font-semibold"
              : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300"
          }`}
        >
          📤 Outbound
        </button>
      </div>

      {filteredInteractions.length === 0 ? (
        <div className="py-6 text-center text-xs text-stone-500">
          <p>No interactions match this filter.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilter("all")}
            className="mt-2 text-xs h-6.5 rounded px-2.5"
          >
            Show All
          </Button>
        </div>
      ) : (
        <div className="relative pl-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-stone-200 dark:before:bg-stone-800">
          {filteredInteractions.map((item) => (
            <TimelineItem key={item.id} item={item} personName={personName} />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="pt-1 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs rounded h-7 px-3 font-medium"
          >
            {loadingMore ? "Loading older interactions…" : "Load older interactions"}
          </Button>
        </div>
      )}
    </div>
  )
}
