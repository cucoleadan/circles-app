import { useCallback, useEffect, useState } from "react"
import { CircleDot } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import type {
  CirclesOverview,
  ListRecord,
  Person,
  TagRecord,
} from "../lib/types"
import { AddContactDialog } from "./add-contact-dialog"
import { BadgeGuideDrawer } from "./badge-guide-drawer"
import { CirclesMetricsRibbon } from "./circles-metrics-ribbon"
import { CirclesSidebar } from "./circles-sidebar"
import { ContactDrawer } from "./contact-drawer"
import { SettingsDialog } from "./settings-dialog"
import { CirclesContactsGrid } from "./workspace/circles-contacts-grid"
import { CirclesMobileStrip } from "./workspace/circles-mobile-strip"
import { CirclesNavbar } from "./workspace/circles-navbar"
import { CirclesToolbar } from "./workspace/circles-toolbar"
import {
  dateRangeOptions,
  useWorkspaceFilters,
} from "./workspace/use-workspace-filters"
import { useWorkspaceLists } from "./workspace/use-workspace-lists"

export function CirclesWorkspace({
  initialOverview,
  initialPeople,
  initialLists,
  initialTags,
}: {
  initialOverview: CirclesOverview | null
  initialPeople: Person[]
  initialLists: ListRecord[]
  initialTags: TagRecord[]
}) {
  const [overview, setOverview] = useState<CirclesOverview | null>(initialOverview)
  const [tags] = useState<TagRecord[]>(initialTags)

  // Modals & Drawers
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isBadgeGuideOpen, setIsBadgeGuideOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<"connection" | "queue" | "extension" | "lists">("connection")
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"active" | "expired" | "none">("active")
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  function refetchPeople() {
    setRefreshKey((k) => k + 1)
  }

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/connection")
      if (res.ok) {
        const data = await res.json()
        setConnectionStatus(data.connection?.status ?? "none")
      }
    } catch {
      // Ignore background check failure
    }
  }, [])

  useEffect(() => {
    void checkConnection()
  }, [checkConnection])

  // Read URL query params on initial mount for person and settings
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const personParam = params.get("person")
    if (personParam) setSelectedPersonId(personParam)

    const settingsParam = params.get("settings")
    if (settingsParam && ["connection", "queue", "extension", "lists"].includes(settingsParam)) {
      setSettingsInitialTab(settingsParam as "connection" | "queue" | "extension" | "lists")
      setIsSettingsOpen(true)
    }
  }, [])

  // Hook for filtering, sorting, date ranges, search, URL sync, and people state
  const filters = useWorkspaceFilters({
    initialPeople,
    lists: initialLists,
    tags,
    refreshKey,
    selectedPersonId,
  })

  // Hook for list management (create, update, delete)
  const { lists, handleCreateList, handleUpdateList, handleDeleteList } = useWorkspaceLists({
    initialLists,
    setPeople: filters.setPeople,
    selectedListId: filters.selectedListId,
    setSelectedListId: filters.setSelectedListId,
    updateUrl: filters.updateUrl,
    setNotice,
  })

  function handleSelectPerson(id: string | null) {
    setSelectedPersonId(id)
    filters.updateUrl({ person: id })
  }

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

  function handlePersonUpdated(updated: Person) {
    filters.setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function handlePersonArchived(id: string) {
    filters.setPeople((prev) => prev.filter((p) => p.id !== id))
    handleSelectPerson(null)
    setNotice("Contact archived.")
    setTimeout(() => setNotice(null), 3000)
  }

  function handlePersonCreated(newPerson: Person) {
    filters.setPeople((prev) => [newPerson, ...prev])
    handleSelectPerson(newPerson.id)
    setNotice(`${newPerson.name} added to your circle.`)
    setTimeout(() => setNotice(null), 3000)
  }

  async function logout() {
    await fetch("/api/auth/sign-out", { method: "POST" })
    window.location.href = "/login"
  }

  return (
    <main className="min-h-screen bg-[#f7f5f1] text-[#191817] dark:bg-stone-950 dark:text-stone-100 flex flex-col">
      <CirclesNavbar
        search={filters.search}
        onSearchChange={filters.setSearch}
        onOpenGuide={() => setIsBadgeGuideOpen(true)}
        onOpenSettings={(tab) => {
          setSettingsInitialTab(tab)
          setIsSettingsOpen(true)
        }}
        onOpenAdd={() => setIsAddOpen(true)}
        onSync={triggerSync}
        isSyncing={isSyncing}
        connectionStatus={connectionStatus}
        onLogout={logout}
      />

      {notice && (
        <div className="bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-xs py-2 px-4 text-center font-medium shadow-sm transition-all">
          {notice}
        </div>
      )}

      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-4 sm:py-8 flex-1 w-full">
        <CirclesMetricsRibbon overview={overview} people={filters.people} topScore={filters.topScore} />

        <CirclesMobileStrip
          currentView={filters.currentView}
          selectedListId={filters.selectedListId}
          selectedTagId={filters.selectedTagId}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onViewChange={filters.handleViewChange}
        />

        <div className="flex flex-col lg:flex-row items-start gap-6 lg:gap-8">
          <div className="hidden lg:block shrink-0">
            <CirclesSidebar
              currentView={filters.currentView}
              onViewChange={filters.handleViewChange}
              selectedListId={filters.selectedListId}
              onListChange={filters.handleListChange}
              selectedTagId={filters.selectedTagId}
              onTagChange={filters.handleTagChange}
              lists={lists}
              tags={tags}
              overview={overview}
              onCreateList={handleCreateList}
              onOpenBadgeGuide={() => setIsBadgeGuideOpen(true)}
              onOpenSettings={(tab) => {
                setSettingsInitialTab(tab || "queue")
                setIsSettingsOpen(true)
              }}
            />
          </div>

          <section className="flex-1 w-full min-w-0">
            <CirclesToolbar
              viewHeading={filters.viewHeading}
              currentView={filters.currentView}
              peopleCount={filters.people.length}
              selectedListId={filters.selectedListId}
              selectedTagId={filters.selectedTagId}
              interactionFilter={filters.interactionFilter}
              dateRange={filters.dateRange}
              search={filters.search}
              currentSort={filters.currentSort}
              lists={lists}
              tags={tags}
              dateRangeOptions={dateRangeOptions}
              onOpenSettings={(tab) => {
                setSettingsInitialTab(tab)
                setIsSettingsOpen(true)
              }}
              onListChange={filters.handleListChange}
              onTagChange={filters.handleTagChange}
              onInteractionFilterChange={filters.handleInteractionFilterChange}
              onDateRangeChange={filters.handleDateRangeChange}
              onSearchClear={() => filters.setSearch("")}
              onResetAllFilters={filters.handleResetAllFilters}
              onSortChange={filters.handleSortChange}
            />

            <CirclesContactsGrid
              people={filters.people}
              visiblePeople={filters.visiblePeople}
              visibleLimit={filters.visibleLimit}
              dateRange={filters.dateRange}
              currentView={filters.currentView}
              onSelectPerson={handleSelectPerson}
              onLoadMore={() => filters.setVisibleLimit((prev) => prev + 48)}
              onClearDateRange={() => filters.handleDateRangeChange("all")}
            />
          </section>
        </div>
      </div>

      <ContactDrawer
        person={filters.activePerson}
        open={Boolean(selectedPersonId && filters.activePerson)}
        onOpenChange={(open) => {
          if (!open) handleSelectPerson(null)
        }}
        onPersonUpdated={handlePersonUpdated}
        onPersonArchived={handlePersonArchived}
        allLists={lists}
        allTags={tags}
        onCreateList={handleCreateList}
      />

      <AddContactDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onCreated={handlePersonCreated}
        allLists={lists}
      />

      <BadgeGuideDrawer
        open={isBadgeGuideOpen}
        onOpenChange={setIsBadgeGuideOpen}
      />

      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        initialTab={settingsInitialTab}
        lists={lists}
        onCreateList={handleCreateList}
        onUpdateList={handleUpdateList}
        onDeleteList={handleDeleteList}
        onSaved={refetchPeople}
        onConnectionUpdated={() => {
          void checkConnection()
          refetchPeople()
        }}
      />

      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[85vw] max-w-xs p-5 overflow-y-auto bg-stone-50 dark:bg-stone-950 border-r border-stone-200 dark:border-stone-800"
        >
          <SheetHeader className="pb-3 border-b border-stone-200 dark:border-stone-800 mb-4">
            <SheetTitle className="text-sm font-bold flex items-center gap-2 text-stone-900 dark:text-stone-100">
              <span className="flex size-6 items-center justify-center rounded-lg bg-[#f15a3a] text-white shadow-xs">
                <CircleDot className="size-3.5" />
              </span>
              Circles Navigation
            </SheetTitle>
          </SheetHeader>
          <CirclesSidebar
            currentView={filters.currentView}
            onViewChange={(v) => {
              filters.handleViewChange(v)
              setIsMobileNavOpen(false)
            }}
            selectedListId={filters.selectedListId}
            onListChange={(l) => {
              filters.handleListChange(l)
              setIsMobileNavOpen(false)
            }}
            selectedTagId={filters.selectedTagId}
            onTagChange={(t) => {
              filters.handleTagChange(t)
              setIsMobileNavOpen(false)
            }}
            lists={lists}
            tags={tags}
            overview={overview}
            onCreateList={handleCreateList}
            onOpenBadgeGuide={() => {
              setIsMobileNavOpen(false)
              setIsBadgeGuideOpen(true)
            }}
            onOpenSettings={(tab) => {
              setIsMobileNavOpen(false)
              setSettingsInitialTab(tab || "queue")
              setIsSettingsOpen(true)
            }}
          />
        </SheetContent>
      </Sheet>
    </main>
  )
}
