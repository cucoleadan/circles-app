import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight,
  Calendar,
  CircleDot,
  Clock,
  HelpCircle,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
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
import { CirclesSidebar } from "./circles-sidebar"
import { ContactDrawer } from "./contact-drawer"
import { HistoryBackfill } from "./history-backfill"

// Backwards compatibility type for initial Astro SSR imports
export type Contact = Person

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  } catch {
    return ""
  }
}

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

interface ReciprocityInfo {
  label: string
  sublabel: string
  variant: "amber" | "sky" | "emerald" | "stone"
  icon: string
}

function getReciprocityBadge(person: Person): ReciprocityInfo | null {
  const inbound = person.inboundInteractionCount ?? 0
  const outbound = person.outboundInteractionCount ?? 0
  const lastInbound = person.lastInboundAt ? new Date(person.lastInboundAt).getTime() : 0
  const lastOutbound = person.lastOutboundAt ? new Date(person.lastOutboundAt).getTime() : 0

  if (inbound === 0 && outbound === 0) {
    return null
  }

  // They reached out, but you never responded
  if (inbound > 0 && outbound === 0) {
    return {
      label: "Needs your reply",
      sublabel: `${inbound} received`,
      variant: "amber",
      icon: "📥",
    }
  }

  // You reached out, but they never responded
  if (outbound > 0 && inbound === 0) {
    return {
      label: "Awaiting response",
      sublabel: `${outbound} given`,
      variant: "stone",
      icon: "📤",
    }
  }

  // Both engaged: who spoke last?
  if (lastInbound > lastOutbound) {
    return {
      label: "Needs reply",
      sublabel: "They engaged last",
      variant: "amber",
      icon: "📥",
    }
  }

  if (lastOutbound > lastInbound) {
    return {
      label: "Ball in their court",
      sublabel: "You engaged last",
      variant: "sky",
      icon: "📤",
    }
  }

  return {
    label: "Mutual circle",
    sublabel: `${inbound} in · ${outbound} out`,
    variant: "emerald",
    icon: "🔄",
  }
}

const statusColors: Record<string, string> = {
  new: "bg-amber-400",
  active: "bg-sky-500",
  close: "bg-emerald-500",
  dormant: "bg-stone-400",
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
  const [isSyncing, setIsSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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
  }, [currentView, currentSort, selectedListId, selectedTagId, search, dateRange])

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
      case "needs-reply":
        return "Needs Your Reply"
      case "awaiting-response":
        return "Awaiting Response"
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
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center justify-between text-xs font-medium text-stone-500">
              <span>Total in Circle</span>
              <Users className="size-3.5 text-stone-400" />
            </div>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              {overview?.people ?? people.length}
            </p>
          </div>

          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center justify-between text-xs font-medium text-stone-500">
              <span>Conversations</span>
              <MessageSquare className="size-3.5 text-sky-500" />
            </div>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
              {people.filter((p) => (p.conversationCount ?? 0) > 0).length}
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
              {overview?.interactions ?? people.reduce((acc, p) => acc + (p.interactionCount ?? 0), 0)}
            </p>
          </div>
        </div>

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
          />

          {/* Cards Section */}
          <section className="flex-1 w-full min-w-0">
            {/* View Header & Sort Controls */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-stone-200/80 dark:border-stone-800">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                  {viewHeading}
                </h2>
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
                {visiblePeople.map((person) => {
                  const hasEngagement = (person.engagementScore ?? 0) > 0
                  const isHighAdvocate = (person.engagementScore ?? 0) >= 30
                  const reciprocity = getReciprocityBadge(person)

                  return (
                    <div
                      key={person.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectPerson(person.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          handleSelectPerson(person.id)
                        }
                      }}
                      className="group cursor-pointer rounded-2xl border border-stone-200/90 bg-white p-4 transition-colors hover:border-[#f15a3a]/60 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-[#f15a3a]/60 flex flex-col justify-between select-none focus:outline-none focus:ring-2 focus:ring-[#f15a3a]/30 shadow-2xs"
                    >
                      <div>
                        {/* Card Header: Avatar, Name, Handle, Score */}
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative shrink-0">
                              <Avatar className="size-10 border border-stone-100 shadow-2xs dark:border-stone-800">
                                <AvatarFallback className="bg-stone-100 font-semibold text-stone-700 text-xs dark:bg-stone-800 dark:text-stone-300">
                                  {initials(person.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white dark:border-stone-900 ${
                                  statusColors[person.relationshipStatus ?? "new"] ?? "bg-stone-400"
                                }`}
                                title={`Status: ${person.relationshipStatus ?? "new"}`}
                              />
                            </div>

                            <div className="min-w-0">
                              <p className="font-bold text-sm tracking-tight text-stone-900 dark:text-stone-100 truncate group-hover:text-[#f15a3a] transition-colors">
                                {person.name}
                              </p>
                              <p className="text-xs text-stone-500 font-mono truncate">
                                {person.handle ? `@${person.handle}` : "—"}
                              </p>
                            </div>
                          </div>

                          {/* Engagement Score Pill */}
                          <div
                            className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              isHighAdvocate
                                ? "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                                : hasEngagement
                                  ? "bg-orange-50 text-[#f15a3a] border border-orange-200 dark:bg-orange-950/40 dark:text-orange-300"
                                  : "bg-stone-100 text-stone-500 border border-stone-200 dark:bg-stone-800 dark:text-stone-400"
                            }`}
                            title={`Engagement score: ${person.engagementScore} pts`}
                          >
                            <Sparkles className="size-3 text-amber-500" />
                            <span>{person.engagementScore}</span>
                          </div>
                        </div>

                        {/* Reciprocity State Chip */}
                        {reciprocity && (
                          <div className="mt-2.5 flex items-center">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold tracking-tight ${
                                reciprocity.variant === "amber"
                                  ? "bg-amber-100/90 text-amber-900 border border-amber-300/80 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800"
                                  : reciprocity.variant === "emerald"
                                    ? "bg-emerald-100/90 text-emerald-900 border border-emerald-300/80 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800"
                                    : reciprocity.variant === "sky"
                                      ? "bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800"
                                      : "bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-400"
                              }`}
                            >
                              <span>{reciprocity.icon}</span>
                              <span>{reciprocity.label}</span>
                              <span className="opacity-60 text-[9.5px] font-normal">
                                • {reciprocity.sublabel}
                              </span>
                            </span>
                          </div>
                        )}

                        {/* Middle: Metrics and Tags */}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                          <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 font-medium">
                            <Clock className="size-2.5 text-stone-400" />
                            {person.interactionCount} actions
                          </span>
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                            {person.inboundInteractionCount ?? 0} received
                          </span>
                          <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                            {person.outboundInteractionCount ?? 0} given
                          </span>
                          {(person.conversationCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 px-2 py-0.5 font-medium">
                              <MessageSquare className="size-2.5" />
                              {person.conversationCount} threads
                            </span>
                          )}
                          <span className="capitalize text-[10px] text-stone-400 ml-auto">
                            {person.driftStatus}
                          </span>
                        </div>

                        {/* Lists Badges */}
                        {(person.lists && person.lists.length > 0) && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {person.lists.map((l) => (
                              <span
                                key={l.id}
                                className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:text-stone-300"
                              >
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Notes Snippet */}
                        {person.notes && (
                          <p className="mt-2.5 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 italic font-serif">
                            "{person.notes}"
                          </p>
                        )}
                      </div>

                      {/* Card Footer: Recency Timestamp & Explicit Details Button */}
                      <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-[11px] text-stone-400">
                        <span>
                          {person.lastInteractionAt
                            ? `Active ${formatDate(person.lastInteractionAt)}`
                            : "No recent activity"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectPerson(person.id)
                          }}
                          className="text-[#f15a3a] hover:text-[#d04325] hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
                        >
                          Details <ArrowUpRight className="size-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
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
    </main>
  )
}
