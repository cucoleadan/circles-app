import { Heart, MessageSquare, Repeat, Sparkles } from "lucide-react"
import type { Person } from "../lib/types"

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never"
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

export function ProfileBreakdown({ person }: { person: Person }) {
  const inbound = person.inboundInteractionCount ?? 0
  const outbound = person.outboundInteractionCount ?? 0
  const total = inbound + outbound
  const inboundPct = total > 0 ? Math.round((inbound / total) * 100) : 0
  const outboundPct = total > 0 ? 100 - inboundPct : 0

  const lastInboundComment = person.lastInboundCommentAt
    ? new Date(person.lastInboundCommentAt).getTime()
    : 0
  const lastOutboundComment = person.lastOutboundCommentAt
    ? new Date(person.lastOutboundCommentAt).getTime()
    : 0
  const lastOutboundLike = person.lastOutboundLikeAt
    ? new Date(person.lastOutboundLikeAt).getTime()
    : 0

  const iLikedLast =
    lastOutboundLike > 0 &&
    (lastOutboundLike >= lastInboundComment ||
      (person.lastActionDirection === "outbound" && person.lastActionType === "like"))

  return (
    <div className="space-y-4">
      {/* 1. Reciprocity Balance Meter */}
      <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
            <Sparkles className="size-3.5 text-[#f15a3a]" />
            <span>Relationship Balance</span>
          </div>

          {/* Reciprocity Status Tag */}
          {lastInboundComment > 0 && lastInboundComment > lastOutboundComment ? (
            iLikedLast ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 text-stone-700 border border-stone-200 px-2.5 py-0.5 text-[11px] font-semibold dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700"
                title="You acknowledged their comment with a like; conversation is ended"
              >
                <span>❤️</span> Convo ended (liked)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 text-[11px] font-bold dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                <span>📥</span> Needs your reply
              </span>
            )
          ) : lastOutboundComment > 0 && lastOutboundComment > lastInboundComment ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 text-sky-900 border border-sky-300 px-2.5 py-0.5 text-[11px] font-bold dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800">
              <span>📤</span> Ball in their court
            </span>
          ) : (person.conversationCount ?? 0) > 0 || (inbound > 0 && outbound > 0) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-0.5 text-[11px] font-bold dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
              <span>🔄</span> Mutual Circle
            </span>
          ) : null}
        </div>

        {/* Dual-Color Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
              <span>📥</span> {inboundPct}% Received ({inbound})
            </span>
            <span className="text-sky-700 dark:text-sky-400 font-semibold flex items-center gap-1">
              <span>📤</span> {outboundPct}% Given ({outbound})
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800 flex">
            <div
              className="bg-emerald-500 h-full transition-all"
              style={{ width: `${inboundPct}%` }}
              title={`Received from them: ${inbound} actions`}
            />
            <div
              className="bg-sky-500 h-full transition-all"
              style={{ width: `${outboundPct}%` }}
              title={`Given to them: ${outbound} actions`}
            />
          </div>
        </div>

        {/* Recency Timestamps */}
        <div className="pt-2 grid grid-cols-2 gap-3 text-xs border-t border-stone-100 dark:border-stone-800">
          <div>
            <span className="text-[11px] text-stone-400 block">Heard from them</span>
            <span className="font-semibold text-stone-800 dark:text-stone-200">
              {person.lastInboundAt ? formatDate(person.lastInboundAt) : "Never"}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-stone-400 block">Your last touch</span>
            <span className="font-semibold text-stone-800 dark:text-stone-200">
              {person.lastOutboundAt ? formatDate(person.lastOutboundAt) : "Never"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Interaction Breakdown by Action Type */}
      <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
          Interaction Breakdown
        </div>

        <div className="grid grid-cols-3 gap-2.5 text-center">
          {/* Likes */}
          <div className="rounded-xl border border-rose-200/70 bg-rose-50/50 p-2.5 dark:border-rose-900/40 dark:bg-rose-950/20">
            <div className="flex items-center justify-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-400">
              <Heart className="size-3.5" /> Likes
            </div>
            <p className="mt-1 text-xl font-bold tracking-tight text-rose-900 dark:text-rose-200">
              {person.likeCount ?? 0}
            </p>
          </div>

          {/* Restacks */}
          <div className="rounded-xl border border-violet-200/70 bg-violet-50/50 p-2.5 dark:border-violet-900/40 dark:bg-violet-950/20">
            <div className="flex items-center justify-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-400">
              <Repeat className="size-3.5" /> Restacks
            </div>
            <p className="mt-1 text-xl font-bold tracking-tight text-violet-900 dark:text-violet-200">
              {person.restackCount ?? 0}
            </p>
          </div>

          {/* Comments */}
          <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="flex items-center justify-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <MessageSquare className="size-3.5" /> Comments
            </div>
            <p className="mt-1 text-xl font-bold tracking-tight text-emerald-900 dark:text-emerald-200">
              {person.commentCount ?? 0}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
