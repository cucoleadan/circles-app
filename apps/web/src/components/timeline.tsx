import { useEffect, useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Heart,
  Loader2,
  MessageCircle,
  MessageSquare,
  Repeat,
  Sparkles,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import type { Interaction } from "../lib/types"

function actionBadge(action: string, body?: string | null) {
  switch (action) {
    case "like":
      return {
        label: "Like",
        pts: 1,
        icon: Heart,
        color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
      }
    case "restack":
      if (body && body.trim().length > 0) {
        return {
          label: "Restack with note",
          pts: 3,
          icon: Repeat,
          color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300",
        }
      }
      return {
        label: "Restack",
        pts: 2,
        icon: Repeat,
        color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300",
      }
    case "comment":
      return {
        label: "Comment",
        pts: 3,
        icon: MessageCircle,
        color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
      }
    case "reply":
      return {
        label: "Reply",
        pts: 3,
        icon: MessageSquare,
        color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300",
      }
    default:
      return {
        label: action,
        pts: 1,
        icon: Sparkles,
        color: "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300",
      }
  }
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60)
    if (diffHours < 24 && diffHours >= 0) {
      if (diffHours < 1) return "Just now"
      return `${Math.floor(diffHours)}h ago`
    }
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    })
  } catch {
    return iso
  }
}

export function Timeline({
  personId,
  personName,
}: {
  personId: string
  personName: string
}) {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [personId])

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
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">
        {error}
      </div>
    )
  }

  if (interactions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 p-8 text-center text-sm text-muted-foreground dark:border-stone-800">
        <p className="font-medium text-stone-700 dark:text-stone-300">No interaction history yet</p>
        <p className="mt-1 text-xs">
          When {personName} interacts on Substack or when you reach out, actions will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative pl-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-stone-200 dark:before:bg-stone-800">
        {interactions.map((item) => {
          const badge = actionBadge(item.actionType, item.body)
          const Icon = badge.icon
          const isInbound = item.direction === "inbound"

          return (
            <div key={item.id} className="relative pb-6 last:pb-2">
              <span
                className={`absolute -left-6 top-1 flex size-5 items-center justify-center rounded-full border text-[10px] ${
                  isInbound
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                    : "border-sky-300 bg-sky-100 text-sky-800"
                }`}
                title={isInbound ? "Inbound (from them)" : "Outbound (from you)"}
              >
                {isInbound ? (
                  <ArrowDownLeft className="size-3" />
                ) : (
                  <ArrowUpRight className="size-3" />
                )}
              </span>

              <div className="rounded-xl border border-stone-200/80 bg-white/70 p-3.5 shadow-xs transition-colors hover:bg-white dark:border-stone-800 dark:bg-stone-900/60">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badge.color}`}
                    >
                      <Icon className="size-3" />
                      {badge.label}
                      <span className="opacity-75 font-normal">+{badge.pts}</span>
                    </span>
                    <span className="text-[11px] font-medium text-stone-500">
                      {isInbound ? personName : "You"}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(item.occurredAt)}
                  </span>
                </div>

                {item.body && (
                  <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-stone-800 dark:text-stone-200 font-sans">
                    {item.body}
                  </p>
                )}

                {(item.targetTitle || item.targetUrl) && (
                  <div className="mt-2.5 flex items-center gap-1.5 pt-2 border-t border-stone-100 dark:border-stone-800 text-[11px] text-muted-foreground">
                    <span className="truncate font-medium text-stone-600 dark:text-stone-400">
                      {item.targetTitle || "Substack conversation"}
                    </span>
                    {item.targetUrl && (
                      <a
                        href={item.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[#f15a3a] hover:underline ml-auto shrink-0"
                      >
                        View <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {nextCursor && (
        <div className="pt-2 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full text-xs"
          >
            {loadingMore ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Loading older history…
              </>
            ) : (
              "Load older interactions"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
