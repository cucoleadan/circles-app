import { useEffect, useState } from "react"
import { Archive } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
} from "@workspace/ui/components/sheet"
import type { ListRecord, Person, TagRecord } from "../lib/types"
import { ContactDetailsTab } from "./contact-details-tab"
import { ContactDrawerHeader } from "./contact-drawer/contact-drawer-header"
import { EditContactDialog } from "./edit-contact-dialog"
import { ProfileBreakdown } from "./profile-breakdown"
import { Timeline } from "./timeline"

export function ContactDrawer({
  person,
  open,
  onOpenChange,
  onPersonUpdated,
  onPersonArchived,
  allLists,
  allTags,
  onCreateList,
}: {
  person: Person | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPersonUpdated: (updated: Person) => void
  onPersonArchived: (id: string) => void
  allLists: ListRecord[]
  allTags: TagRecord[]
  onCreateList?: (name: string) => Promise<ListRecord | void>
}) {
  const [activeTab, setActiveTab] = useState<"timeline" | "details">("timeline")
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editFocusField, setEditFocusField] = useState<"name" | "handle">("name")
  const [refetchJob, setRefetchJob] = useState<{ personId: string; jobId: string } | null>(null)
  const [refetchStarting, setRefetchStarting] = useState(false)
  const [timelineRefresh, setTimelineRefresh] = useState(0)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!refetchJob) return
    let stopped = false
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/people/${refetchJob.personId}/refetch/${refetchJob.jobId}`)
        if (!response.ok) throw new Error("Could not check refetch status")
        const data = await response.json()
        if (stopped) return
        if (data.status === "done") {
          const updated = await fetch(`/api/v1/people/${refetchJob.personId}`)
          if (!updated.ok) throw new Error("Refetch finished, but contact could not be reloaded")
          const detail = await updated.json()
          if (stopped) return
          onPersonUpdated({ ...detail.person, lists: detail.lists, tags: detail.tags })
          setTimelineRefresh((value) => value + 1)
          setToast({ message: "Contact refetched successfully", error: false })
          setRefetchJob(null)
        } else if (data.status === "dead" || data.status === "failed") {
          setToast({ message: "Contact refetch failed. Please try again later.", error: true })
          setRefetchJob(null)
        }
      } catch {
        if (!stopped) {
          setToast({ message: "Could not check contact refetch status", error: true })
          setRefetchJob(null)
        }
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => { stopped = true; clearInterval(timer) }
  }, [refetchJob, onPersonUpdated])

  if (!person) return null

  async function refetchContact() {
    if (!person || refetchStarting || refetchJob) return
    setRefetchStarting(true)
    try {
      const response = await fetch(`/api/v1/people/${person.id}/refetch`, { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not start contact refetch")
      setRefetchJob({ personId: person.id, jobId: data.jobId })
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Could not start contact refetch", error: true })
    } finally {
      setRefetchStarting(false)
    }
  }

  function openEditModal(focus: "name" | "handle" = "name") {
    setEditFocusField(focus)
    setIsEditingProfile(true)
  }

  const isIgnored = (person.lists ?? []).some((l) => l.name.toLowerCase() === "ignored")

  async function toggleIgnore() {
    if (!person) return
    try {
      if (isIgnored) {
        const ignoredList = person.lists?.find((l) => l.name.toLowerCase() === "ignored")
        if (ignoredList) {
          await fetch(`/api/v1/lists/${ignoredList.id}/members/${person.id}`, { method: "DELETE" })
          const updatedLists = (person.lists ?? []).filter((l) => l.id !== ignoredList.id)
          onPersonUpdated({ ...person, lists: updatedLists })
        }
      } else {
        let ignoredList = allLists.find((l) => l.name.toLowerCase() === "ignored")
        if (!ignoredList) {
          if (onCreateList) {
            const res = await onCreateList("Ignored")
            if (res && "id" in res) ignoredList = res
          }
          if (!ignoredList) {
            const res = await fetch("/api/v1/lists", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "Ignored" }),
            })
            if (res.ok) {
              const data = await res.json()
              ignoredList = data.list
            }
          }
        }
        if (ignoredList) {
          await fetch(`/api/v1/lists/${ignoredList.id}/members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ personId: person.id }),
          })
          const updatedLists = [...(person.lists ?? []), { id: ignoredList.id, name: ignoredList.name, createdAt: new Date().toISOString() }]
          onPersonUpdated({ ...person, lists: updatedLists })
        }
      }
    } catch (err) {
      console.error("Error toggling ignored status:", err)
    }
  }

  async function addToList(listId: string) {
    if (!listId || !person) return
    const targetList = allLists.find((l) => l.id === listId)
    if (!targetList) return
    try {
      const res = await fetch(`/api/v1/lists/${listId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: person.id }),
      })
      if (!res.ok) throw new Error("Failed to add to list")
      const currentLists = person.lists ?? []
      if (!currentLists.some((l) => l.id === listId)) {
        const updatedLists = [...currentLists, { id: listId, name: targetList.name, createdAt: new Date().toISOString() }]
        onPersonUpdated({ ...person, lists: updatedLists })
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function archivePerson() {
    if (!person) return
    try {
      const res = await fetch(`/api/v1/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relationshipStatus: "dormant" }),
      })
      if (!res.ok) throw new Error("Failed to archive person")
      onPersonArchived(person.id)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="w-full sm:max-w-[864px] p-0 flex flex-col h-full bg-stone-50/95 dark:bg-stone-950 backdrop-blur-md overflow-hidden border-l border-stone-200 dark:border-stone-800"
          showCloseButton={false}
        >
          <SheetHeader className="p-0 border-b border-stone-200/80 bg-white/80 dark:bg-stone-900/80 dark:border-stone-800 space-y-0">
            <ContactDrawerHeader
              person={person}
              allLists={allLists}
              isIgnored={isIgnored}
              onOpenEdit={openEditModal}
              onToggleIgnore={toggleIgnore}
              onAddToList={addToList}
              onRefetch={refetchContact}
              refetching={refetchStarting || Boolean(refetchJob)}
              onClose={() => onOpenChange(false)}
            />

            {/* Navigation Tabs (Compact & Less Rounded) */}
            <div className="px-4 pb-2 pt-0.5">
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-stone-100/90 dark:bg-stone-800/80 rounded text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("timeline")}
                  className={`py-1 rounded font-medium transition-all ${
                    activeTab === "timeline"
                      ? "bg-white text-stone-900 shadow-2xs font-bold dark:bg-stone-900 dark:text-stone-100"
                      : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                  }`}
                >
                  Interaction Timeline
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  className={`py-1 rounded font-medium transition-all ${
                    activeTab === "details"
                      ? "bg-white text-stone-900 shadow-2xs font-bold dark:bg-stone-900 dark:text-stone-100"
                      : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                  }`}
                >
                  Details &amp; Notes
                </button>
              </div>
            </div>
          </SheetHeader>

          {/* Drawer Body Area (Tightened padding & spacing) */}
          <div className="flex-1 overflow-y-auto px-4 py-2.5">
            {activeTab === "timeline" && (
              <div className="space-y-2.5">
                <ProfileBreakdown person={person} />
                <Timeline personId={person.id} personName={person.name} refreshKey={timelineRefresh} />
              </div>
            )}

            {activeTab === "details" && (
              <ContactDetailsTab
                person={person}
                allLists={allLists}
                allTags={allTags}
                onPersonUpdated={onPersonUpdated}
                onCreateList={onCreateList}
                onOpenEditProfile={() => openEditModal("name")}
              />
            )}
          </div>

          {/* Footer Actions (Compact) */}
          <div className="px-4 py-2 border-t border-stone-200/80 bg-white dark:bg-stone-900 dark:border-stone-800 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={archivePerson}
              className="text-stone-400 hover:text-destructive text-xs h-7 px-2"
            >
              <Archive className="size-3.5 mr-1" />
              Archive Contact
            </Button>

            <span className="text-[11px] text-stone-400">
              Synced with Substack
            </span>
          </div>
        </SheetContent>
      </Sheet>

      {toast && (
        <div role={toast.error ? "alert" : "status"} className={`fixed bottom-4 right-4 z-[100] rounded-md px-4 py-2 text-sm text-white shadow-lg ${toast.error ? "bg-rose-700" : "bg-emerald-700"}`}>
          {toast.message}
        </div>
      )}

      {/* Profile Details Edit Modal */}
      <EditContactDialog
        open={isEditingProfile}
        onOpenChange={setIsEditingProfile}
        person={person}
        initialFocus={editFocusField}
        onPersonUpdated={onPersonUpdated}
      />
    </>
  )
}
