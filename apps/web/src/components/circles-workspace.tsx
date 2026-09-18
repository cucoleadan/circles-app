import { useEffect, useMemo, useState } from "react"
import {
  Calendar,
  CircleDot,
  HelpCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type {
  CirclesOverview,
  DateRangePreset,
  ListRecord,
  PeopleSort,
  PeopleView,
  Person,
  TagRecord,
} from "../lib/types"
import { AddContactDialog } from "./add-contact-dialog"
import { BadgeGuideDrawer } from "./badge-guide-drawer"
import { CirclesMetricsRibbon } from "./circles-metrics-ribbon"
import { CirclesSidebar } from "./circles-sidebar"
import { ContactCard } from "./contact-card"
import { ContactDrawer } from "./contact-drawer"
import { HistoryBackfill } from "./history-backfill"
import { SettingsDialog } from "./settings-dialog"

// Backwards compatibility type for initial Astro SSR imports
export type Contact = Person

const dateRangeOptions: { id: DateRangePreset; label: string; days?: number }[] = [
  { id: "all", label: "All Time" },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "14d", label: "Last 14 days", days: 14 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
]

function getSinceDate(preset: DateRangePreset): string | undefined {
  const opt = dateRangeOptions.find((o) => o.id === preset)
  if (!opt || !opt.days) return undefined
  const d = new Date()
  d.setDate(d.getDate() - opt.days)
  return d.toISOString()
}

export function CirclesWorkspace({
  initialPeople,
  initialContacts,
  initialLists = [],
  initialTags = [],
  initialOverview = null,
}: {
  initialPeople?: Person[]
  initialContacts?: Person[]
  initialLists?: ListRecord[]
  initialTags?: TagRecord[]
  initialOverview?: CirclesOverview | null
}) {
  const initial = initialPeople ?? initialContacts ?? []
  const [people, setPeople] = useState<Person[]>(initial)
  const [lists, setLists] = useState<ListRecord[]>(initialLists)
  const [tags] = useState<TagRecord[]>(initialTags)
  const [overview, setOverview] = useState<CirclesOverview | null>(initialOverview)

  // Filters & Navigation
  const [currentView, setCurrentView] = useState<PeopleView>("all")
  const [currentSort, setCurrentSort] = useState<PeopleSort>("engagement")
  const [dateRange, setDateRange] = useState<DateRangePreset>("all")
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [visibleLimit, setVisibleLimit] = useState(48)

  // Modals & Drawers
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isBadgeGuideOpen, setIsBadgeGuideOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  function refetchPeople() {
    setRefreshKey((k) => k + 1)
  }

  // Read URL query params on initial mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const personParam = params.get("person")
    if (personParam) setSelectedPersonId(personParam)

    const viewParam = params.get("view") as PeopleView | null
    if (viewParam) setCurrentView(viewParam)

    const listParam = params.get("list")
    if (listParam) setSelectedListId(listParam)

    const tagParam = params.get("tag")
    if (tagParam) setSelectedTagId(tagParam)

    const sortParam = params.get("sort") as PeopleSort | null
    if (sortParam) setCurrentSort(sortParam)

    const rangeParam = params.get("range") as DateRangePreset | null
    if (rangeParam && ["all", "7d", "14d", "30d", "90d"].includes(rangeParam)) {
      setDateRange(rangeParam)
    }
  }, [])

  // Sync state back to URL
  function updateUrl(params: Record<string, string | null>) {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value)
      } else {
        url.searchParams.delete(key)
      }
    }
    window.history.replaceState({}, "", url.toString())
  }

  // Handle Person Drawer selection
  function handleSelectPerson(id: string | null) {
    setSelectedPersonId(id)
    updateUrl({ person: id })
  }

  // Handle View Change
  function handleViewChange(view: PeopleView) {
    setCurrentView(view)
    setSelectedListId(null)
    setSelectedTagId(null)
    updateUrl({ view: view === "all" ? null : view, list: null, tag: null })
  }

  // Handle List Change
  function handleListChange(listId: string | null) {
    setSelectedListId(listId)
    setSelectedTagId(null)
    updateUrl({ list: listId, tag: null })
  }

  // Handle Tag Change
  function handleTagChange(tagId: string | null) {
    setSelectedTagId(tagId)
    setSelectedListId(null)
    updateUrl({ tag: tagId, list: null })
  }

  // Handle Sort Change
  function handleSortChange(sort: PeopleSort) {
    setCurrentSort(sort)
    updateUrl({ sort })
  }

  // Handle Date Range Change
  function handleDateRangeChange(range: DateRangePreset) {
    setDateRange(range)
    updateUrl({ range: range === "all" ? null : range })
  }

  // Refetch people when filters change
  useEffect(() => {
    const query = new URLSearchParams()
    if (currentView && currentView !== "all" && !selectedListId && !selectedTagId) {
      query.set("view", currentView)
    }
    if (currentSort) query.set("sort", currentSort)
    if (selectedListId) query.set("listId", selectedListId)
    if (selectedTagId) query.set("tagId", selectedTagId)
    if (search.trim()) query.set("search", search.trim())
    const since = getSinceDate(dateRange)
    if (since) query.set("since", since)
    query.set("limit", "1000")

    fetch(`/api/v1/people?${query.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch people")
        return res.json()
      })
      .then((data) => {
        setPeople(data.people ?? [])
        setVisibleLimit(48)
      })
      .catch((err) => console.error("Error fetching people:", err))
  }, [currentView, currentSort, selectedListId, selectedTagId, search, dateRange, refreshKey])

  // Sync Substack activity
  async function triggerSync() {
    if (isSyncing) return
    setIsSyncing(true)
    setNotice("Refreshing Substack activity in the background…")
    try {
      const res = await fetch("/api/v1/sync", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Sync request failed")
      }
      setNotice("Sync job enqueued! Activity is processing.")
      // Re-fetch overview & people after short delay
      setTimeout(() => {
        fetch("/api/v1/circles")
          .then((res) => res.json())
          .then(setOverview)
          .catch(() => {})
      }, 3000)
    } catch (err: any) {
      setNotice(`Sync note: ${err.message}`)
    } finally {
      setTimeout(() => setIsSyncing(false), 1000)
      setTimeout(() => setNotice(null), 4000)
    }
  }

  // Create List
  async function handleCreateList(name: string) {
    try {
      const res = await fetch("/api/v1/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error("Failed to create list")
      const data = await res.json()
      setLists((prev) => [
        ...prev,
        { id: data.list.id, name: data.list.name, count: 0, createdAt: new Date().toISOString() },
      ])
      setNotice(`Created list "${name}"`)
      setTimeout(() => setNotice(null), 3000)
    } catch (err: any) {
      setNotice(`Error: ${err.message}`)
    }
  }

  // Update a person in local state
  function handlePersonUpdated(updated: Person) {
    setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  // Archive a person
  function handlePersonArchived(id: string) {
    setPeople((prev) => prev.filter((p) => p.id !== id))
    handleSelectPerson(null)
    setNotice("Contact archived.")
    setTimeout(() => setNotice(null), 3000)
  }

  // Add newly created person
  function handlePersonCreated(newPerson: Person) {
    setPeople((prev) => [newPerson, ...prev])
    handleSelectPerson(newPerson.id)
    setNotice(`${newPerson.name} added to your circle.`)
    setTimeout(() => setNotice(null), 3000)
  }

  async function logout() {
    await fetch("/api/auth/sign-out", { method: "POST" })
    window.location.href = "/login"
  }

  const activePerson = useMemo(() => {
    if (!selectedPersonId) return null
    return people.find((p) => p.id === selectedPersonId) ?? null
  }, [people, selectedPersonId])

  const visiblePeople = useMemo(() => {
    return people.slice(0, visibleLimit)
  }, [people, visibleLimit])

  const viewHeading = useMemo(() => {
    if (selectedListId) {
      const list = lists.find((l) => l.id === selectedListId)
      return `List: ${list?.name ?? "Custom List"}`
    }
    if (selectedTagId) {
      const tag = tags.find((t) => t.id === selectedTagId)
      return `Tag: ${tag?.name ?? "Custom Tag"}`
    }
    switch (currentView) {
      case "priority":
        return "Priority to Engage"
      case "needs-reply":
        return "Needs Your Reply"
      case "awaiting-response":
        return "Ball in Their Court"
      case "mutual":
        return "Mutual Circle"
      case "conversations":
        return "Conversations"
      case "inbound":
        return "Inbound Touches"
      case "outbound":
        return "Outbound Touches"
      case "opportunities":
        return "Opportunities"
      case "no-history":
        return "New & No History"
      default:
        return "All Contacts"
    }
  }, [currentView, selectedListId, selectedTagId, lists, tags])

  const topScore = useMemo(() => {
    if (!people.length) return 0
    return Math.max(...people.map((p) => p.engagementScore ?? 0))
  }, [people])

  return (
    <main className="min-h-screen bg-[#f7f5f1] text-[#191817] dark:bg-stone-950 dark:text-stone-100 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/80 dark:border-stone-800 dark:bg-stone-900/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 font-bold tracking-tight text-sm sm:text-base">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#f15a3a] text-white shadow-xs">
                <CircleDot className="size-4" />
              </span>
              <span>Circles</span>
            </div>
            <span className="hidden sm:inline-block rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 dark:text-stone-300">
              CRM & Relationships
            </span>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-md mx-2 sm:mx-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or @handle…"
                className="pl-9 h-9 text-xs bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded-full"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <HistoryBackfill />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsBadgeGuideOpen(true)}
              className="h-8.5 rounded-full text-xs font-medium border-stone-200"
              title="Badge & Scoring Guide"
            >
              <HelpCircle className="size-3.5 mr-1 text-stone-500" />
              <span className="hidden sm:inline">Guide</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={triggerSync}
              disabled={isSyncing}
              className="h-8.5 rounded-full text-xs font-medium border-stone-200"
              title="Sync latest Substack activity"
            >
              <RefreshCw
                className={`size-3.5 mr-1.5 ${isSyncing ? "animate-spin text-[#f15a3a]" : ""}`}
              />
              <span className="hidden sm:inline">Sync</span>
            </Button>

            <Button
              size="sm"
              onClick={() => setIsAddOpen(true)}
              className="h-8.5 rounded-full bg-[#191817] hover:bg-[#302e2c] text-white text-xs font-semibold px-3.5 shadow-xs"
            >
              <Plus className="size-3.5 mr-1" />
              <span className="hidden sm:inline">Add Person</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Sign out"
              className="size-8.5 rounded-full text-stone-500 hover:text-stone-800"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Notice Banner */}
      {notice && (
        <div className="bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-xs py-2 px-4 text-center font-medium shadow-sm transition-all">
          {notice}
        </div>
      )}

      {/* Main Content Area */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full">
        {/* Metric Ribbon */}
        <CirclesMetricsRibbon overview={overview} people={people} topScore={topScore} />

        {/* Workspace Layout */}
        <div className="flex flex-col lg:flex-row items-start gap-8">
          {/* Sidebar */}
          <CirclesSidebar
            currentView={currentView}
            onViewChange={handleViewChange}
            selectedListId={selectedListId}
            onListChange={handleListChange}
            selectedTagId={selectedTagId}
            onTagChange={handleTagChange}
            lists={lists}
            tags={tags}
            overview={overview}
            onCreateList={handleCreateList}
            onOpenBadgeGuide={() => setIsBadgeGuideOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          {/* Cards Section */}
          <section className="flex-1 w-full min-w-0">
            {/* View Header & Sort Controls */}
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
                      onClick={() => setIsSettingsOpen(true)}
                      className="h-7 rounded-full text-xs font-medium border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xs hover:border-[#f15a3a]/50 text-stone-700 dark:text-stone-300"
                      title="Adjust queue thresholds and rules"
                    >
                      <Settings className="size-3 mr-1 text-[#f15a3a]" />
                      Queue Settings
                    </Button>
                  )}
                </div>
                <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>
                    Showing {people.length} {people.length === 1 ? "person" : "people"}
                  </span>
                  {dateRange !== "all" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-stone-200/70 dark:bg-stone-800 px-2 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
                      Active: {dateRangeOptions.find((o) => o.id === dateRange)?.label}
                      <button
                        type="button"
                        onClick={() => handleDateRangeChange("all")}
                        className="ml-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
                        title="Clear date filter"
                      >
                        ×
                      </button>
                    </span>
                  )}
                </p>
              </div>

              {/* Toolbar Controls: Activity Date Range & Sort */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {/* Date Range Selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                    <Calendar className="size-3" /> Activity:
                  </span>
                  <Select
                    value={dateRange}
                    onValueChange={(v) => handleDateRangeChange(v as DateRangePreset)}
                  >
                    <SelectTrigger className="h-8 text-xs font-medium w-36 bg-white dark:bg-stone-900">
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
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                    <SlidersHorizontal className="size-3" /> Sort:
                  </span>
                  <Select
                    value={currentSort}
                    onValueChange={(v) => handleSortChange(v as PeopleSort)}
                  >
                    <SelectTrigger className="h-8 text-xs font-medium w-44 bg-white dark:bg-stone-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="engagement" className="text-xs">
                        ⭐️ Highest Engagement
                      </SelectItem>
                      <SelectItem value="recent_conversation" className="text-xs">
                        💬 Recent Conversation
                      </SelectItem>
                      <SelectItem value="recent_interaction" className="text-xs">
                        🕒 Recent Activity
                      </SelectItem>
                      <SelectItem value="name" className="text-xs">
                        🔤 Name (A-Z)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* People Cards Grid */}
            {people.length === 0 ? (
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
                    onClick={() => handleDateRangeChange("all")}
                    className="mt-3 text-xs h-8 rounded-full"
                  >
                    Show All Time
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visiblePeople.map((person) => (
                  <ContactCard
                    key={person.id}
                    person={person}
                    onSelect={handleSelectPerson}
                    currentView={currentView}
                  />
                ))}
              </div>
            )}

            {people.length > visibleLimit && (
              <div className="mt-6 flex justify-center pb-2">
                <Button
                  variant="outline"
                  onClick={() => setVisibleLimit((prev) => prev + 48)}
                  className="text-xs font-semibold rounded-full px-5 h-8 border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                >
                  Load more ({visibleLimit} of {people.length})
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Slide-over Contact Drawer */}
      <ContactDrawer
        person={activePerson}
        open={Boolean(selectedPersonId && activePerson)}
        onOpenChange={(open) => {
          if (!open) handleSelectPerson(null)
        }}
        onPersonUpdated={handlePersonUpdated}
        onPersonArchived={handlePersonArchived}
        allLists={lists}
        allTags={tags}
      />

      {/* Add Contact Modal */}
      <AddContactDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onCreated={handlePersonCreated}
      />

      {/* Badge & Scoring Guide Drawer */}
      <BadgeGuideDrawer
        open={isBadgeGuideOpen}
        onOpenChange={setIsBadgeGuideOpen}
      />

      {/* Queue Criteria & Adaptive Thresholds Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSaved={refetchPeople}
      />
    </main>
  )
}
