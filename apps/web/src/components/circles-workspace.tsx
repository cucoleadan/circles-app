import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight,
  CircleDot,
  Clock,
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
  ListRecord,
  PeopleSort,
  PeopleView,
  Person,
  TagRecord,
} from "../lib/types"
import { AddContactDialog } from "./add-contact-dialog"
import { CirclesSidebar } from "./circles-sidebar"
import { ContactDrawer } from "./contact-drawer"

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
    const now = new Date()
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60)
    if (diffHours < 24 && diffHours >= 0) {
      if (diffHours < 1) return "Just now"
      return `${Math.floor(diffHours)}h ago`
    }
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    })
  } catch {
    return iso
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
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  // Modals & Drawers
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
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
    query.set("limit", "1000")

    fetch(`/api/v1/people?${query.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch people")
        return res.json()
      })
      .then((data) => {
        setPeople(data.people ?? [])
      })
      .catch((err) => console.error("Error fetching people:", err))
  }, [currentView, currentSort, selectedListId, selectedTagId, search])

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
      case "conversations":
        return "Conversations"
      case "inbound":
        return "Inbound Advocates"
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
          />

          {/* Cards Section */}
          <section className="flex-1 w-full min-w-0">
            {/* View Header & Sort Controls */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-stone-200/80 dark:border-stone-800">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                  {viewHeading}
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Showing {people.length} {people.length === 1 ? "person" : "people"}
                </p>
              </div>

              {/* Sort Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                  <SlidersHorizontal className="size-3" /> Sort:
                </span>
                <Select value={currentSort} onValueChange={(v) => handleSortChange(v as PeopleSort)}>
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

            {/* People Cards Grid */}
            {people.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 p-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/50">
                <Users className="mx-auto size-8 text-stone-400 mb-2" />
                <p className="font-semibold text-stone-800 dark:text-stone-200">
                  No contacts match this view
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Try clearing your search query, choosing a different filter, or adding a new contact.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {people.map((person) => {
                  const hasEngagement = (person.engagementScore ?? 0) > 0
                  const isHighAdvocate = (person.engagementScore ?? 0) >= 30

                  return (
                    <div
                      key={person.id}
                      onClick={() => handleSelectPerson(person.id)}
                      className="group cursor-pointer rounded-2xl border border-stone-200/90 bg-white p-4 transition-all hover:border-[#f15a3a]/40 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:hover:border-[#f15a3a]/40 flex flex-col justify-between"
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

                        {/* Middle: Metrics and Tags */}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                          <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 font-medium">
                            <Clock className="size-2.5 text-stone-400" />
                            {person.interactionCount} actions
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

                      {/* Card Footer: Recency Timestamp */}
                      <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-[11px] text-stone-400">
                        <span>
                          {person.lastInteractionAt
                            ? `Active ${formatDate(person.lastInteractionAt)}`
                            : "No recent activity"}
                        </span>
                        <span className="text-[#f15a3a] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 font-medium">
                          Details <ArrowUpRight className="size-3" />
                        </span>
                      </div>
                    </div>
                  )
                })}
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
    </main>
  )
}
