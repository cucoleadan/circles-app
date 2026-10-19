import { Clock, MessageSquare, Sparkles, Users } from "lucide-react"
import type { ActionCount, CirclesOverview, Person } from "../lib/types"

export function CirclesMetricsRibbon({
  overview,
  people,
  topScore,
}: {
  overview: CirclesOverview | null
  people: Person[]
  topScore: number
}) {
  const totalInCircle = overview?.people ?? people.length
  const totalConversations = people.filter((p) => (p.conversationCount ?? 0) > 0).length
  const totalActions =
    overview?.interactions ?? people.reduce((acc, p) => acc + (p.interactionCount ?? 0), 0)

  return (
    <div className="mb-4 sm:mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
      <div className="rounded-2xl border border-stone-200/80 bg-white p-3 sm:p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-[11px] sm:text-xs font-medium text-stone-500">
          <span>Total in Circle</span>
          <Users className="size-3.5 text-stone-400" />
        </div>
        <p className="mt-1 sm:mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {totalInCircle}
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white p-3 sm:p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-[11px] sm:text-xs font-medium text-stone-500">
          <span>Conversations</span>
          <MessageSquare className="size-3.5 text-sky-500" />
        </div>
        <p className="mt-1 sm:mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
          {totalConversations}
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white p-3 sm:p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-[11px] sm:text-xs font-medium text-stone-500">
          <span>Top Score</span>
          <Sparkles className="size-3.5 text-amber-500" />
        </div>
        <p className="mt-1 sm:mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-[#f15a3a]">
          {topScore} <span className="text-[11px] sm:text-xs font-normal text-stone-500">pts</span>
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white p-3 sm:p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-[11px] sm:text-xs font-medium text-stone-500">
          <span>Total Actions</span>
          <Clock className="size-3.5 text-emerald-500" />
        </div>
        <p className="mt-1 sm:mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {totalActions}
        </p>
      </div>

      <ActionBreakdown actions={overview?.actions ?? []} />
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = { like: "Likes", restack: "Restacks", comment: "Comments", reply: "Replies" }

/** Given vs received per action over the last 30 days; the tooltip carries all-time and 7-day totals. */
function ActionBreakdown({ actions }: { actions: ActionCount[] }) {
  const find = (direction: string, actionType: string) =>
    actions.find((row) => row.direction === direction && row.actionType === actionType)
  const rows = Object.entries(ACTION_LABELS)
    .map(([actionType, label]) => ({ label, given: find("outbound", actionType), received: find("inbound", actionType) }))
    .filter((row) => row.given || row.received)
  if (rows.length === 0) return null

  return (
    <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-stone-200/80 bg-white px-3 py-2 text-[11px] sm:text-xs text-stone-500 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
      <span className="font-medium">Last 30 days · given / received</span>
      {rows.map(({ label, given, received }) => (
        <span
          key={label}
          title={`${label}: ${given?.total ?? 0} given / ${received?.total ?? 0} received all time; ${given?.last7d ?? 0} / ${received?.last7d ?? 0} in the last 7 days`}
        >
          {label}{" "}
          <strong className="text-stone-900 dark:text-stone-100">{given?.last30d ?? 0}</strong>
          {" / "}
          <strong className="text-stone-900 dark:text-stone-100">{received?.last30d ?? 0}</strong>
        </span>
      ))}
    </div>
  )
}
