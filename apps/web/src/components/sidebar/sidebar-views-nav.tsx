import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  EyeOff,
  HelpCircle,
  Inbox,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import type { CirclesOverview, PeopleView } from "../../lib/types"

export const actionViews: { id: PeopleView; label: string; icon: any; desc: string }[] = [
  {
    id: "comments",
    label: "Comments",
    icon: MessageSquare,
    desc: "Comments received on your Notes and articles, with recorded replies, Likes, and per-comment Not interested choices.",
  },
  {
    id: "newsletter",
    label: "Newsletter Signals",
    icon: Mail,
    desc: "Newsletter Signals: Email open rates per post and per subscriber, calculated from a Substack export you request.",
  },
  {
    id: "priority",
    label: "Priority to Engage",
    icon: Sparkles,
    desc: "Priority to Engage: Top unreciprocated supporters, recent restackers, and drifting advocates based on your rules.",
  },
  {
    id: "needs-reply",
    label: "Needs Your Reply",
    icon: Inbox,
    desc: "Needs Your Reply: Contacts who commented or replied to you where you haven't responded yet.",
  },
  {
    id: "awaiting-response",
    label: "Ball in Their Court",
    icon: Send,
    desc: "Ball in Their Court: Contacts where you commented or replied within the last 7 days; waiting on them.",
  },
  {
    id: "mutual",
    label: "Mutual Circle",
    icon: RefreshCw,
    desc: "Mutual Circle: Active two-way relationships with regular reciprocal interactions.",
  },
]

export const directoryViews: { id: PeopleView; label: string; icon: any; desc: string }[] = [
  {
    id: "all",
    label: "All Contacts",
    icon: Users,
    desc: "All Contacts: Everyone in your CRM, regardless of activity status.",
  },
  {
    id: "conversations",
    label: "Conversations",
    icon: MessageSquare,
    desc: "Conversations: Contacts with whom you have exchanged comments or replies in threads.",
  },
  {
    id: "inbound",
    label: "Inbound Touches",
    icon: ArrowDownLeft,
    desc: "Inbound Touches: Contacts who reached out to you with likes, restacks, or comments.",
  },
  {
    id: "outbound",
    label: "Outbound Touches",
    icon: ArrowUpRight,
    desc: "Outbound Touches: Contacts you have engaged with via likes, restacks, or replies.",
  },
  {
    id: "opportunities",
    label: "Opportunities",
    icon: Sparkles,
    desc: "Opportunities: Past supporters with positive engagement who have drifted inactive (14+ days since last touch) — prime candidates to reconnect with!",
  },
  {
    id: "no-history",
    label: "No History",
    icon: Clock,
    desc: "No History: Newly imported contacts or subscribers with no recorded interactions yet.",
  },
  {
    id: "follows-not-subscribed",
    label: "Follows · Not Subscribed",
    icon: UserCheck,
    desc: "Follows · Not Subscribed: People who follow your Substack profile/Notes but haven't subscribed to your publication.",
  },
  {
    id: "ignored",
    label: "Ignored",
    icon: EyeOff,
    desc: "Ignored: Contacts hidden from all action queues and directory views.",
  },
]

export function SidebarViewsNav({
  currentView,
  selectedListId,
  selectedTagId,
  overview,
  onViewChange,
}: {
  currentView: PeopleView
  selectedListId: string | null
  selectedTagId: string | null
  overview: CirclesOverview | null
  onViewChange: (view: PeopleView) => void
}) {
  return (
    <>
      {/* Action Queues */}
      <div className="space-y-1">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-[#f15a3a] flex items-center gap-1">
          <Sparkles className="size-3" /> Action Queues
        </p>
        <div className="space-y-0.5 pt-1">
          {actionViews.map((v) => {
            const Icon = v.icon
            const isActive = currentView === v.id && !selectedListId && !selectedTagId
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => onViewChange(v.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onViewChange(v.id)
                  }
                }}
                className={`group w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer select-none ${
                  isActive
                    ? "bg-[#191817] text-white font-semibold shadow-xs"
                    : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate min-w-0">
                  <Icon
                    className={`size-4 shrink-0 ${
                      isActive ? "text-[#f15a3a]" : "text-stone-400"
                    }`}
                  />
                  <span className="truncate">{v.label}</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={`p-0.5 rounded-full cursor-help transition-all ${
                          isActive
                            ? "text-stone-300 hover:text-white"
                            : "text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 opacity-60 group-hover:opacity-100"
                        }`}
                        aria-label={`About ${v.label}`}
                      >
                        <HelpCircle className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center" className="max-w-xs p-2.5">
                      <p className="font-semibold text-xs text-white dark:text-stone-900">{v.label}</p>
                      <p className="text-[11px] text-stone-300 dark:text-stone-600 mt-1 leading-relaxed">{v.desc}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Primary Views */}
      <div className="space-y-1">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Directory
        </p>
        <div className="space-y-0.5 pt-1">
          {directoryViews.map((v) => {
            const Icon = v.icon
            const isActive = currentView === v.id && !selectedListId && !selectedTagId
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => onViewChange(v.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onViewChange(v.id)
                  }
                }}
                className={`group w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer select-none ${
                  isActive
                    ? "bg-[#191817] text-white font-semibold shadow-xs"
                    : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate min-w-0">
                  <Icon
                    className={`size-4 shrink-0 ${
                      isActive ? "text-[#f15a3a]" : "text-stone-400"
                    }`}
                  />
                  <span className="truncate">{v.label}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {v.id === "all" && overview?.people !== undefined && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-full ${
                        isActive ? "bg-white/20 text-white" : "text-stone-400"
                      }`}
                    >
                      {overview.people}
                    </span>
                  )}
                  {v.id === "follows-not-subscribed" && overview?.followsNotSubscribed !== undefined && overview.followsNotSubscribed > 0 && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-full font-semibold ${
                        isActive ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300"
                      }`}
                    >
                      {overview.followsNotSubscribed}
                    </span>
                  )}
                  {v.id === "ignored" && overview?.ignored !== undefined && overview.ignored > 0 && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-full font-semibold ${
                        isActive ? "bg-white/20 text-white" : "bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300"
                      }`}
                    >
                      {overview.ignored}
                    </span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={`p-0.5 rounded-full cursor-help transition-all ${
                          isActive
                            ? "text-stone-300 hover:text-white"
                            : "text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 opacity-60 group-hover:opacity-100"
                        }`}
                        aria-label={`About ${v.label}`}
                      >
                        <HelpCircle className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center" className="max-w-xs p-2.5">
                      <p className="font-semibold text-xs text-white dark:text-stone-900">{v.label}</p>
                      <p className="text-[11px] text-stone-300 dark:text-stone-600 mt-1 leading-relaxed">{v.desc}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
