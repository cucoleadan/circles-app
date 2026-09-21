import { HelpCircle, Settings } from "lucide-react"
import type { CirclesOverview, ListRecord, PeopleView, TagRecord } from "../lib/types"
import { SidebarListsSection } from "./sidebar/sidebar-lists-section"
import { SidebarTagsSection } from "./sidebar/sidebar-tags-section"
import { actionViews, SidebarViewsNav } from "./sidebar/sidebar-views-nav"

export { actionViews }

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
  onOpenSettings,
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
  onCreateList: (name: string) => Promise<ListRecord | void>
  onOpenBadgeGuide?: () => void
  onOpenSettings?: (tab?: "connection" | "queue" | "extension" | "lists") => void
}) {
  return (
    <aside className="w-full lg:w-64 space-y-6 shrink-0">
      {/* Navigation Views (Action Queues & Directory) */}
      <SidebarViewsNav
        currentView={currentView}
        selectedListId={selectedListId}
        selectedTagId={selectedTagId}
        overview={overview}
        onViewChange={onViewChange}
      />

      {/* Lists */}
      <SidebarListsSection
        lists={lists}
        selectedListId={selectedListId}
        onListChange={onListChange}
        onTagChange={onTagChange}
        onCreateList={onCreateList}
        onOpenSettings={onOpenSettings}
      />

      {/* Tags */}
      <SidebarTagsSection
        tags={tags}
        selectedTagId={selectedTagId}
        onListChange={onListChange}
        onTagChange={onTagChange}
      />

      {/* Quick Guide & Settings Link */}
      <div className="pt-2 px-3 space-y-2 border-t border-stone-200/60 dark:border-stone-800/60">
        {onOpenBadgeGuide && (
          <button
            type="button"
            onClick={onOpenBadgeGuide}
            className="w-full flex items-center gap-2 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 text-xs py-1 transition-colors"
          >
            <HelpCircle className="size-3.5 text-stone-400" />
            <span>Badge &amp; Scoring Guide</span>
          </button>
        )}
        {onOpenSettings && (
          <button
            type="button"
            onClick={() => onOpenSettings("connection")}
            className="w-full flex items-center justify-between text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 text-xs py-1 transition-colors"
            title="Configure Workspace Settings & Substack Connection"
          >
            <div className="flex items-center gap-2">
              <Settings className="size-3.5 text-stone-400" />
              <span>Workspace Settings</span>
            </div>
            <span className="text-[10px] text-stone-400">⌘,</span>
          </button>
        )}
      </div>
    </aside>
  )
}
