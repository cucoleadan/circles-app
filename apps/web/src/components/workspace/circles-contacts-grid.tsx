import { Users } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { DateRangePreset, PeopleView, Person } from "../../lib/types"
import { ContactCard } from "../contact-card"

export function CirclesContactsGrid({
  people,
  visiblePeople,
  visibleLimit,
  dateRange,
  currentView,
  onSelectPerson,
  onLoadMore,
  onClearDateRange,
}: {
  people: Person[]
  visiblePeople: Person[]
  visibleLimit: number
  dateRange: DateRangePreset
  currentView: PeopleView
  onSelectPerson: (id: string | null) => void
  onLoadMore: () => void
  onClearDateRange: () => void
}) {
  if (people.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 p-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/50">
        <Users className="mx-auto size-8 text-stone-400 mb-2" />
        <p className="font-semibold text-stone-800 dark:text-stone-200">
          No contacts match this view
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          {dateRange !== "all"
            ? "No contacts had activity within the selected time window."
            : "Try clearing your search query, choosing a different filter, or adding a new contact."}
        </p>
        {dateRange !== "all" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onClearDateRange}
            className="mt-3 text-xs h-8 rounded-full"
          >
            Show All Time
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visiblePeople.map((person) => (
          <ContactCard
            key={person.id}
            person={person}
            onSelect={onSelectPerson}
            currentView={currentView}
          />
        ))}
      </div>

      {people.length > visibleLimit && (
        <div className="mt-6 flex justify-center pb-2">
          <Button
            variant="outline"
            onClick={onLoadMore}
            className="text-xs font-semibold rounded-full px-5 h-8 border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            Load more ({visibleLimit} of {people.length})
          </Button>
        </div>
      )}
    </>
  )
}
