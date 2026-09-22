import { Bookmark, Calendar, Filter, Settings, SlidersHorizontal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { DateRangePreset, ListRecord, PeopleSort, PeopleView, TagRecord } from "../../lib/types"

export function CirclesToolbar({
  viewHeading,
  currentView,
  peopleCount,
  selectedListId,
  selectedTagId,
  interactionFilter,
  dateRange,
  search,
  currentSort,
  lists,
  tags,
  dateRangeOptions,
  onOpenSettings,
  onListChange,
  onTagChange,
  onInteractionFilterChange,
  onDateRangeChange,
  onSearchClear,
  onResetAllFilters,
  onSortChange,
}: {
  viewHeading: string
  currentView: PeopleView
  peopleCount: number
  selectedListId: string | null
  selectedTagId: string | null
  interactionFilter: "all" | "restack" | "comment" | "like"
  dateRange: DateRangePreset
  search: string
  currentSort: PeopleSort
  lists: ListRecord[]
  tags: TagRecord[]
  dateRangeOptions: { id: DateRangePreset; label: string }[]
  onOpenSettings: (tab: "connection" | "queue" | "extension" | "lists") => void
  onListChange: (listId: string | null) => void
  onTagChange: (tagId: string | null) => void
  onInteractionFilterChange: (val: "all" | "restack" | "comment" | "like") => void
  onDateRangeChange: (val: DateRangePreset) => void
  onSearchClear: () => void
  onResetAllFilters: () => void
  onSortChange: (sort: PeopleSort) => void
}) {
  const hasActiveFilters = Boolean(
    selectedListId ||
      selectedTagId ||
      interactionFilter !== "all" ||
      dateRange !== "all" ||
      search.trim()
  )

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-stone-200/80 dark:border-stone-800">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {viewHeading}
          </h2>
          {currentView === "priority" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenSettings("queue")}
              className="h-7 rounded text-xs font-medium border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xs hover:border-[#f15a3a]/50 text-stone-700 dark:text-stone-300"
              title="Adjust queue thresholds and rules"
            >
              <Settings className="size-3 mr-1 text-[#f15a3a]" />
              Workspace Settings
            </Button>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>
            Showing {peopleCount} {peopleCount === 1 ? "person" : "people"}
          </span>
          {selectedListId && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100/80 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 px-1.5 py-0.5 text-[11px] font-medium">
              List: {lists.find((l) => l.id === selectedListId)?.name ?? "List"}
              <button
                type="button"
                onClick={() => onListChange(null)}
                className="ml-0.5 hover:opacity-75"
                title="Clear list filter"
              >
                ×
              </button>
            </span>
          )}
          {selectedTagId && (
            <span className="inline-flex items-center gap-1 rounded bg-indigo-100/80 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 px-1.5 py-0.5 text-[11px] font-medium">
              #{tags.find((t) => t.id === selectedTagId)?.name ?? "Tag"}
              <button
                type="button"
                onClick={() => onTagChange(null)}
                className="ml-0.5 hover:opacity-75"
                title="Clear tag filter"
              >
                ×
              </button>
            </span>
          )}
          {interactionFilter !== "all" && (
            <span className="inline-flex items-center gap-1 rounded bg-stone-200/70 dark:bg-stone-800 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
              Action: {interactionFilter}
              <button
                type="button"
                onClick={() => onInteractionFilterChange("all")}
                className="ml-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
                title="Clear action filter"
              >
                ×
              </button>
            </span>
          )}
          {dateRange !== "all" && (
            <span className="inline-flex items-center gap-1 rounded bg-stone-200/70 dark:bg-stone-800 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
              Active: {dateRangeOptions.find((o) => o.id === dateRange)?.label}
              <button
                type="button"
                onClick={() => onDateRangeChange("all")}
                className="ml-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
                title="Clear date filter"
              >
                ×
              </button>
            </span>
          )}
          {search.trim() && (
            <span className="inline-flex items-center gap-1 rounded bg-stone-200/70 dark:bg-stone-800 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
              Search: "{search.trim()}"
              <button
                type="button"
                onClick={onSearchClear}
                className="ml-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
                title="Clear search"
              >
                ×
              </button>
            </span>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetAllFilters}
              className="text-[11px] font-semibold text-[#f15a3a] hover:underline ml-1 cursor-pointer"
              title="Reset all active filters"
            >
              Reset filters
            </button>
          )}
        </p>
      </div>

      {/* Toolbar Controls: List Filter, Action Type, Date Range & Sort */}
      <div className="grid grid-cols-2 gap-2 w-full lg:flex lg:w-auto lg:flex-wrap lg:items-center lg:gap-2.5">
        {/* List Filter Selector */}
        {lists.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full lg:w-auto">
            <span className="text-[11px] sm:text-xs font-medium text-stone-500 flex items-center gap-1 shrink-0">
              <Bookmark className="size-3" /> List:
            </span>
            <Select
              value={selectedListId ?? "all"}
              onValueChange={(val) => onListChange(val === "all" ? null : val)}
            >
              <SelectTrigger className="h-8 text-xs font-medium w-full lg:min-w-32 bg-white dark:bg-stone-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Lists
                </SelectItem>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id} className="text-xs">
                    {l.name.toLowerCase() === "ignored" ? "🚫 " : ""}
                    {l.name} ({l.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Interaction / Action Type Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full lg:w-auto">
          <span className="text-[11px] sm:text-xs font-medium text-stone-500 flex items-center gap-1 shrink-0">
            <Filter className="size-3" /> Action:
          </span>
          <Select
            value={interactionFilter}
            onValueChange={(v) => onInteractionFilterChange(v as any)}
          >
            <SelectTrigger className="h-8 text-xs font-medium w-full lg:w-36 bg-white dark:bg-stone-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                All Actions
              </SelectItem>
              <SelectItem value="restack" className="text-xs">
                🔁 Has Restacks
              </SelectItem>
              <SelectItem value="comment" className="text-xs">
                💬 Has Comments
              </SelectItem>
              <SelectItem value="like" className="text-xs">
                ❤️ Has Likes
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date Range Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full lg:w-auto">
          <span className="text-[11px] sm:text-xs font-medium text-stone-500 flex items-center gap-1 shrink-0">
            <Calendar className="size-3" /> Activity:
          </span>
          <Select
            value={dateRange}
            onValueChange={(v) => onDateRangeChange(v as DateRangePreset)}
          >
            <SelectTrigger className="h-8 text-xs font-medium w-full lg:w-36 bg-white dark:bg-stone-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                📅 All Time
              </SelectItem>
              <SelectItem value="7d" className="text-xs">
                ⚡️ Last 7 days
              </SelectItem>
              <SelectItem value="14d" className="text-xs">
                ⚡️ Last 14 days
              </SelectItem>
              <SelectItem value="30d" className="text-xs">
                🗓️ Last 30 days
              </SelectItem>
              <SelectItem value="90d" className="text-xs">
                🗓️ Last 90 days
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Sort Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full lg:w-auto">
          <span className="text-[11px] sm:text-xs font-medium text-stone-500 flex items-center gap-1 shrink-0">
            <SlidersHorizontal className="size-3" /> Sort:
          </span>
          <Select
            value={currentSort}
            onValueChange={(v) => onSortChange(v as PeopleSort)}
          >
            <SelectTrigger className="h-8 text-xs font-medium w-full lg:min-w-44 bg-white dark:bg-stone-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="engagement" className="text-xs">
                ⭐️ Highest Engagement
              </SelectItem>
              <SelectItem value="engagement_asc" className="text-xs">
                ⭐️ Lowest Engagement
              </SelectItem>
              <SelectItem value="recent_interaction" className="text-xs">
                🕒 Activity (Newest)
              </SelectItem>
              <SelectItem value="recent_interaction_asc" className="text-xs">
                🕒 Activity (Oldest)
              </SelectItem>
              <SelectItem value="inbound_desc" className="text-xs">
                📥 Heard From Them (Newest)
              </SelectItem>
              <SelectItem value="inbound_asc" className="text-xs">
                📥 Heard From Them (Oldest)
              </SelectItem>
              <SelectItem value="outbound_desc" className="text-xs">
                📤 Your Last Touch (Newest)
              </SelectItem>
              <SelectItem value="outbound_asc" className="text-xs">
                📤 Your Last Touch (Oldest)
              </SelectItem>
              <SelectItem value="recent_conversation" className="text-xs">
                💬 Recent Conversation
              </SelectItem>
              <SelectItem value="name" className="text-xs">
                🔤 Name (A-Z)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
