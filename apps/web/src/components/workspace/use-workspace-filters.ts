import { useEffect, useMemo, useState } from "react"
import type {
  DateRangePreset,
  ListRecord,
  PeopleSort,
  PeopleView,
  Person,
  TagRecord,
} from "../../lib/types"

export const dateRangeOptions: { id: DateRangePreset; label: string }[] = [
  { id: "all", label: "All Time" },
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
]

export function getSinceDate(preset: DateRangePreset): string | null {
  if (preset === "all") return null
  const now = new Date()
  const days = preset === "7d" ? 7 : preset === "14d" ? 14 : preset === "30d" ? 30 : 90
  now.setDate(now.getDate() - days)
  return now.toISOString()
}

export function useWorkspaceFilters({
  initialPeople,
  lists,
  tags,
  refreshKey,
  selectedPersonId,
}: {
  initialPeople: Person[]
  lists: ListRecord[]
  tags: TagRecord[]
  refreshKey: number
  selectedPersonId: string | null
}) {
  const [people, setPeople] = useState<Person[]>(initialPeople)
  const [currentView, setCurrentView] = useState<PeopleView>("all")
  const [currentSort, setCurrentSort] = useState<PeopleSort>("engagement")
  const [dateRange, setDateRange] = useState<DateRangePreset>("all")
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [interactionFilter, setInteractionFilter] = useState<"all" | "restack" | "comment" | "like">("all")
  const [search, setSearch] = useState("")
  const [visibleLimit, setVisibleLimit] = useState(48)

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

  // Read URL query params on initial mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
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

  function handleViewChange(view: PeopleView) {
    setCurrentView(view)
    setSelectedListId(null)
    setSelectedTagId(null)
    setInteractionFilter("all")
    setDateRange("all")
    setSearch("")
    setCurrentSort("engagement")
    setVisibleLimit(48)
    updateUrl({
      view: view === "all" ? null : view,
      list: null,
      tag: null,
      action: null,
      range: null,
      sort: null,
      search: null,
      person: selectedPersonId,
    })
  }

  function handleListChange(listId: string | null) {
    setSelectedListId(listId)
    setSelectedTagId(null)
    setInteractionFilter("all")
    setDateRange("all")
    setSearch("")
    setCurrentSort("engagement")
    setVisibleLimit(48)
    if (listId) {
      setCurrentView("all")
      updateUrl({
        view: null,
        list: listId,
        tag: null,
        action: null,
        range: null,
        sort: null,
        search: null,
        person: selectedPersonId,
      })
    } else {
      updateUrl({ list: null })
    }
  }

  function handleTagChange(tagId: string | null) {
    setSelectedTagId(tagId)
    setSelectedListId(null)
    setInteractionFilter("all")
    setDateRange("all")
    setSearch("")
    setCurrentSort("engagement")
    setVisibleLimit(48)
    if (tagId) {
      setCurrentView("all")
      updateUrl({
        view: null,
        tag: tagId,
        list: null,
        action: null,
        range: null,
        sort: null,
        search: null,
        person: selectedPersonId,
      })
    } else {
      updateUrl({ tag: null })
    }
  }

  function handleSortChange(sort: PeopleSort) {
    setCurrentSort(sort)
    updateUrl({ sort })
  }

  function handleDateRangeChange(range: DateRangePreset) {
    setDateRange(range)
    updateUrl({ range: range === "all" ? null : range })
  }

  function handleInteractionFilterChange(val: "all" | "restack" | "comment" | "like") {
    setInteractionFilter(val)
    updateUrl({ action: val === "all" ? null : val })
  }

  function handleResetAllFilters() {
    setSelectedListId(null)
    setSelectedTagId(null)
    setInteractionFilter("all")
    setDateRange("all")
    setSearch("")
    setCurrentSort("engagement")
    setVisibleLimit(48)
    updateUrl({
      list: null,
      tag: null,
      action: null,
      range: null,
      sort: null,
      search: null,
      person: selectedPersonId,
    })
  }

  // Refetch people when filters change
  useEffect(() => {
    if (currentView === "comments") return
    const query = new URLSearchParams()
    if (currentView && currentView !== "all") {
      query.set("view", currentView)
    }
    if (currentSort) query.set("sort", currentSort)
    if (selectedListId) query.set("listId", selectedListId)
    if (selectedTagId) query.set("tagId", selectedTagId)
    if (interactionFilter !== "all") query.set("actionType", interactionFilter)
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
  }, [currentView, currentSort, selectedListId, selectedTagId, interactionFilter, search, dateRange, refreshKey])

  const activePerson = useMemo(() => {
    if (!selectedPersonId) return null
    return people.find((p) => p.id === selectedPersonId) ?? null
  }, [people, selectedPersonId])

  const visiblePeople = useMemo(() => {
    return people.slice(0, visibleLimit)
  }, [people, visibleLimit])

  const viewHeading = useMemo(() => {
    let base = "All Contacts"
    switch (currentView) {
      case "priority":
        base = "Priority to Engage"
        break
      case "needs-reply":
        base = "Needs Your Reply"
        break
      case "awaiting-response":
        base = "Ball in Their Court"
        break
      case "mutual":
        base = "Mutual Circle"
        break
      case "conversations":
        base = "Conversations"
        break
      case "inbound":
        base = "Inbound Touches"
        break
      case "outbound":
        base = "Outbound Touches"
        break
      case "opportunities":
        base = "Opportunities"
        break
      case "no-history":
        base = "New & No History"
        break
      case "follows-not-subscribed":
        base = "Follows · Not Subscribed"
        break
      case "ignored":
        base = "Ignored Contacts"
        break
      default:
        base = "All Contacts"
    }

    if (selectedListId) {
      const list = lists.find((l) => l.id === selectedListId)
      return currentView !== "all"
        ? `${base} · ${list?.name ?? "List"}`
        : `List: ${list?.name ?? "Custom List"}`
    }
    if (selectedTagId) {
      const tag = tags.find((t) => t.id === selectedTagId)
      return currentView !== "all"
        ? `${base} · #${tag?.name ?? "Tag"}`
        : `Tag: #${tag?.name ?? "Custom Tag"}`
    }
    return base
  }, [currentView, selectedListId, selectedTagId, lists, tags])

  const topScore = useMemo(() => {
    if (!people.length) return 0
    return Math.max(...people.map((p) => p.engagementScore ?? 0))
  }, [people])

  return {
    people,
    setPeople,
    currentView,
    currentSort,
    dateRange,
    selectedListId,
    setSelectedListId,
    selectedTagId,
    interactionFilter,
    search,
    setSearch,
    visibleLimit,
    setVisibleLimit,
    activePerson,
    visiblePeople,
    viewHeading,
    topScore,
    handleViewChange,
    handleListChange,
    handleTagChange,
    handleSortChange,
    handleDateRangeChange,
    handleInteractionFilterChange,
    handleResetAllFilters,
    updateUrl,
  }
}
