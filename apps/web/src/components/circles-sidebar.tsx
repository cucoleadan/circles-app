import { useState, type SyntheticEvent } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  Clock,
  HelpCircle,
  Inbox,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Users,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import type { CirclesOverview, ListRecord, PeopleView, TagRecord } from "../lib/types"

const actionViews: { id: PeopleView; label: string; icon: any; desc: string }[] = [
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

const views: { id: PeopleView; label: string; icon: any; desc: string }[] = [
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
]

export function CirclesSidebar({
  currentView,
  onViewChange,
  selectedListId,
  onListChange,
  selectedTagId,
  onTagChange,
  lists,
  tags,
  overview,
  onCreateList,
  onOpenBadgeGuide,
}: {
  currentView: PeopleView
  onViewChange: (view: PeopleView) => void
  selectedListId: string | null
  onListChange: (listId: string | null) => void
  selectedTagId: string | null
  onTagChange: (tagId: string | null) => void
  lists: ListRecord[]
  tags: TagRecord[]
  overview: CirclesOverview | null
  onCreateList: (name: string) => Promise<void>
  onOpenBadgeGuide?: () => void
}) {
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState("")
  const [submittingList, setSubmittingList] = useState(false)

  async function handleCreateList(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newListName.trim() || submittingList) return
    setSubmittingList(true)
    try {
      await onCreateList(newListName.trim())
      setNewListName("")
      setIsCreatingList(false)
    } finally {
      setSubmittingList(false)
    }
  }

  return (
    <aside className="w-full lg:w-64 space-y-6 shrink-0">
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
                onClick={() => {
                  onListChange(null)
                  onTagChange(null)
                  onViewChange(v.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onListChange(null)
                    onTagChange(null)
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
          {views.map((v) => {
            const Icon = v.icon
            const isActive = currentView === v.id && !selectedListId && !selectedTagId
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onListChange(null)
                  onTagChange(null)
                  onViewChange(v.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onListChange(null)
                    onTagChange(null)
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
                  {v.id === "all" && overview && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-full ${
                        isActive ? "bg-white/20 text-white" : "text-stone-400"
                      }`}
                    >
                      {overview.people}
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

      {/* Lists */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Lists
          </p>
          <button
            type="button"
            onClick={() => setIsCreatingList((prev) => !prev)}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
            title="Create list"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {isCreatingList && (
          <form onSubmit={handleCreateList} className="px-3 pt-1 flex items-center gap-1.5">
            <Input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="List name…"
              className="h-7 text-xs"
              autoFocus
            />
            <Button
              type="submit"
              size="sm"
              disabled={submittingList || !newListName.trim()}
              className="h-7 px-2 text-xs"
            >
              <Check className="size-3" />
            </Button>
          </form>
        )}

        <div className="space-y-0.5">
          {lists.map((l) => {
            const isActive = selectedListId === l.id
            return (
              <button
                key={l.id}
                type="button"
                title={`Filter by list: ${l.name} (${l.count} ${l.count === 1 ? "contact" : "contacts"})`}
                onClick={() => {
                  onTagChange(null)
                  onListChange(isActive ? null : l.id)
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  isActive
                    ? "bg-stone-200/80 font-semibold text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/60"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Bookmark className="size-3.5 text-stone-400 shrink-0" />
                  <span className="truncate">{l.name}</span>
                </div>
                <span className="text-[11px] text-stone-400 shrink-0">{l.count}</span>
              </button>
            )
          })}
          {lists.length === 0 && (
            <p className="px-3 text-xs text-stone-400 italic">No lists created yet</p>
          )}
        </div>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Tags
          </p>
          <div className="flex flex-wrap gap-1 px-3">
            {tags.map((t) => {
              const isActive = selectedTagId === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  title={`Filter by tag: ${t.name}`}
                  onClick={() => {
                    onListChange(null)
                    onTagChange(isActive ? null : t.id)
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all border ${
                    isActive
                      ? "ring-2 ring-stone-900 dark:ring-stone-100"
                      : "opacity-80 hover:opacity-100"
                  }`}
                  style={{
                    backgroundColor: t.color ? `${t.color}15` : "#635bff15",
                    borderColor: t.color ? `${t.color}40` : "#635bff40",
                    color: t.color || "#635bff",
                  }}
                >
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.color || "#635bff" }}
                  />
                  <span>{t.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Guide & Documentation */}
      {onOpenBadgeGuide && (
        <div className="pt-2 border-t border-stone-200/80 dark:border-stone-800">
          <button
            type="button"
            onClick={onOpenBadgeGuide}
            title="Badge & Scoring Guide: Learn how scores, reciprocity badges, and drift statuses are calculated"
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-stone-800 transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <HelpCircle className="size-4 text-stone-400 group-hover:text-[#f15a3a] shrink-0 transition-colors" />
              <span>Badge &amp; Scoring Guide</span>
            </div>
            <span className="text-[10px] font-semibold text-stone-400 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded-md">
              Docs
            </span>
          </button>
        </div>
      )}
    </aside>
  )
}
