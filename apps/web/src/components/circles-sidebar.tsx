import { useState, type SyntheticEvent } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  Clock,
  MessageSquare,
  Plus,
  Sparkles,
  Users,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import type { CirclesOverview, ListRecord, PeopleView, TagRecord } from "../lib/types"

const views: { id: PeopleView; label: string; icon: any; desc: string }[] = [
  {
    id: "all",
    label: "All Contacts",
    icon: Users,
    desc: "Everyone in your CRM",
  },
  {
    id: "conversations",
    label: "Conversations",
    icon: MessageSquare,
    desc: "Exchanged replies & notes",
  },
  {
    id: "inbound",
    label: "Inbound",
    icon: ArrowDownLeft,
    desc: "Reached out to you",
  },
  {
    id: "outbound",
    label: "Outbound",
    icon: ArrowUpRight,
    desc: "You engaged with them",
  },
  {
    id: "opportunities",
    label: "Opportunities",
    icon: Sparkles,
    desc: "Advocates needing reconnection",
  },
  {
    id: "no-history",
    label: "No History",
    icon: Clock,
    desc: "New additions without interactions",
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
      {/* Primary Views */}
      <div className="space-y-1">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Views
        </p>
        <div className="space-y-0.5 pt-1">
          {views.map((v) => {
            const Icon = v.icon
            const isActive = currentView === v.id && !selectedListId && !selectedTagId
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onListChange(null)
                  onTagChange(null)
                  onViewChange(v.id)
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#191817] text-white font-semibold shadow-xs"
                    : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={`size-4 shrink-0 ${
                      isActive ? "text-[#f15a3a]" : "text-stone-400"
                    }`}
                  />
                  <span className="truncate">{v.label}</span>
                </div>
                {v.id === "all" && overview && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-full ${
                      isActive ? "bg-white/20 text-white" : "text-stone-400"
                    }`}
                  >
                    {overview.people}
                  </span>
                )}
              </button>
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
    </aside>
  )
}
