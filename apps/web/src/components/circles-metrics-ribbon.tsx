import { Clock, MessageSquare, Sparkles, Users } from "lucide-react"
import type { CirclesOverview, Person } from "../lib/types"

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
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-xs font-medium text-stone-500">
          <span>Total in Circle</span>
          <Users className="size-3.5 text-stone-400" />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {totalInCircle}
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-xs font-medium text-stone-500">
          <span>Conversations</span>
          <MessageSquare className="size-3.5 text-sky-500" />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
          {totalConversations}
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-xs font-medium text-stone-500">
          <span>Top Score</span>
          <Sparkles className="size-3.5 text-amber-500" />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-[#f15a3a]">
          {topScore} <span className="text-xs font-normal text-stone-500">pts</span>
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between text-xs font-medium text-stone-500">
          <span>Total Actions</span>
          <Clock className="size-3.5 text-emerald-500" />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {totalActions}
        </p>
      </div>
    </div>
  )
}
