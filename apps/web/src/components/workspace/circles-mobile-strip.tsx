import { SlidersHorizontal, Users } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { PeopleView } from "../../lib/types"
import { actionViews } from "../circles-sidebar"

export function CirclesMobileStrip({
  currentView,
  selectedListId,
  selectedTagId,
  onOpenMobileNav,
  onViewChange,
}: {
  currentView: PeopleView
  selectedListId: string | null
  selectedTagId: string | null
  onOpenMobileNav: () => void
  onViewChange: (view: PeopleView) => void
}) {
  return (
    <div className="lg:hidden mb-4 flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar -mx-3 px-3">
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenMobileNav}
        className="h-8 rounded-full text-xs font-semibold shrink-0 bg-white dark:bg-stone-900 border-stone-300 dark:border-stone-700 shadow-2xs gap-1.5 text-stone-800 dark:text-stone-200"
      >
        <SlidersHorizontal className="size-3 text-[#f15a3a]" />
        <span>Views &amp; Lists</span>
      </Button>

      <div className="h-4 w-[1px] bg-stone-300 dark:bg-stone-700 shrink-0 mx-0.5" />

      {actionViews.map((v) => {
        const Icon = v.icon
        const isActive = currentView === v.id && !selectedListId && !selectedTagId
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onViewChange(v.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all select-none ${
              isActive
                ? "bg-[#191817] text-white shadow-xs"
                : "bg-white text-stone-700 border border-stone-200/90 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:border-stone-800"
            }`}
          >
            <Icon className={`size-3 shrink-0 ${isActive ? "text-[#f15a3a]" : "text-stone-400"}`} />
            <span>{v.label}</span>
          </button>
        )
      })}

      <button
        type="button"
        onClick={() => onViewChange("all")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all select-none ${
          currentView === "all" && !selectedListId && !selectedTagId
            ? "bg-[#191817] text-white shadow-xs"
            : "bg-white text-stone-700 border border-stone-200/90 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:border-stone-800"
        }`}
      >
        <Users
          className={`size-3 shrink-0 ${
            currentView === "all" && !selectedListId && !selectedTagId ? "text-[#f15a3a]" : "text-stone-400"
          }`}
        />
        <span>All</span>
      </button>
    </div>
  )
}
