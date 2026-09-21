import { useState } from "react"
import { Archive, Ban, Edit2, ExternalLink, EyeOff, Plus, Sparkles } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@workspace/ui/components/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import type { ListRecord, Person, TagRecord } from "../lib/types"
import { ContactDetailsTab } from "./contact-details-tab"
import { EditContactDialog } from "./edit-contact-dialog"
import { ProfileBreakdown } from "./profile-breakdown"
import { Timeline } from "./timeline"

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never"
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

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
  if (!person) return null

  const [activeTab, setActiveTab] = useState<"timeline" | "details">("timeline")
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editFocusField, setEditFocusField] = useState<"name" | "handle">("name")

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
          const updatedLists = [...(person.lists ?? []), { id: ignoredList.id, name: ignoredList.name }]
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
        const updatedLists = [...currentLists, { id: listId, name: targetList.name }]
        onPersonUpdated({ ...person, lists: updatedLists })
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function archive() {
    if (!person) return
    if (!window.confirm(`Archive ${person.name}? You can restore archived contacts later.`))
      return
    try {
      const res = await fetch(`/api/v1/people/${person.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to archive contact")
      onPersonArchived(person.id)
      onOpenChange(false)
    } catch (err) {
      console.error(err)
    }
  }

  const substackUrl =
    person.profileUrl ||
    (person.handle ? `https://substack.com/@${person.handle.replace(/^@/, "")}` : null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-stone-50/95 dark:bg-stone-950 backdrop-blur-md overflow-hidden border-l border-stone-200 dark:border-stone-800"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{person.name}</SheetTitle>
          <SheetDescription>Contact profile and conversation timeline for {person.name}</SheetDescription>
        </SheetHeader>

        {/* Header */}
        <div className="p-6 pb-4 border-b border-stone-200/80 bg-white/80 dark:bg-stone-900/80 dark:border-stone-800">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar className="size-13 border-2 border-white shadow-xs dark:border-stone-800 shrink-0">
                <AvatarImage src={person.avatarUrl ?? undefined} alt={person.name} referrerPolicy="no-referrer" />
                <AvatarFallback className="bg-stone-200 text-stone-700 font-semibold text-sm dark:bg-stone-800 dark:text-stone-300">
                  {initials(person.name)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight truncate text-stone-900 dark:text-stone-100">
                    {person.name}
                  </h2>
                  {substackUrl && (
                    <a
                      href={substackUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open Substack profile"
                      className="text-stone-400 hover:text-[#f15a3a] transition-colors"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  {person.handle ? (
                    <span className="font-mono text-stone-600 dark:text-stone-300 font-medium">@{person.handle}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openEditModal("handle")}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#f15a3a] hover:underline"
                      title="Add Substack handle"
                    >
                      <Plus className="size-3" /> Add handle
                    </button>
                  )}
                  <span>·</span>
                  <span
                    className="capitalize text-stone-600 dark:text-stone-400"
                    title="Recency: Active (<30d), Slipping (30-60d), Dormant (>60d)"
                  >
                    {person.driftStatus}
                  </span>
                </div>

                {person.lists && person.lists.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {person.lists.map((l) => (
                      <span
                        key={l.id}
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${
                          l.name.toLowerCase() === "ignored"
                            ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
                            : "border-stone-200 bg-stone-100/80 text-stone-700 dark:border-stone-800 dark:bg-stone-800/80 dark:text-stone-300"
                        }`}
                      >
                        {l.name.toLowerCase() === "ignored" ? "🚫 Ignored" : l.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Follower / Subscriber Audience Chips */}
                {(person.isSubscriber || person.isFollower) && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {person.isFollower && !person.isSubscriber && (
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
                        👤 Follows · Not Subscribed
                      </span>
                    )}
                    {person.isSubscriber && (
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                        📬 {person.subscriptionTier ? `${person.subscriptionTier.toUpperCase()} Subscriber` : "Subscriber"}
                      </span>
                    )}
                    {person.isFollower && person.isSubscriber && (
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-400">
                        Follower
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions & Lists */}
            <div className="shrink-0 flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditModal("name")}
                className="h-8 rounded-full text-xs font-medium px-2.5 gap-1.5 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 hover:text-stone-900 shadow-2xs"
                title="Edit profile details (name, handle, Substack URLs, ID)"
              >
                <Edit2 className="size-3 text-[#f15a3a]" /> Edit
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={toggleIgnore}
                className={`h-8 rounded-full text-xs font-medium px-2.5 gap-1.5 ${
                  isIgnored
                    ? "text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100"
                    : "text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 hover:text-rose-600"
                }`}
                title={isIgnored ? "Remove from Ignored list" : "Ignore from Action Queues"}
              >
                {isIgnored ? (
                  <>
                    <EyeOff className="size-3.5" /> Ignored
                  </>
                ) : (
                  <>
                    <Ban className="size-3.5" /> Ignore
                  </>
                )}
              </Button>

              <Select value="" onValueChange={addToList}>
                <SelectTrigger className="h-8 rounded-full text-xs font-medium px-2.5 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 gap-1 w-auto min-w-[70px]">
                  <Plus className="size-3" /> List
                </SelectTrigger>
                <SelectContent align="end" className="w-44 text-xs">
                  {allLists.length === 0 ? (
                    <SelectItem value="__none__" disabled className="text-xs text-muted-foreground">
                      No lists created
                    </SelectItem>
                  ) : (
                    allLists.map((l) => {
                      const inList = (person.lists ?? []).some((pl) => pl.id === l.id)
                      return (
                        <SelectItem key={l.id} value={l.id} disabled={inList} className="text-xs">
                          {l.name} {inList ? "✓" : ""}
                        </SelectItem>
                      )
                    })
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Engagement Score & Activity Banner */}
          <div className="mt-4 grid grid-cols-5 gap-2 rounded-xl border border-stone-200/80 bg-stone-50 p-2.5 text-center dark:border-stone-800 dark:bg-stone-900">
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500 flex items-center justify-center gap-1">
                <Sparkles className="size-3 text-amber-500" /> Score
              </span>
              <span className="text-lg font-bold text-[#f15a3a] mt-0.5">
                {person.engagementScore}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Received</span>
              <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
                {person.inboundInteractionCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Given</span>
              <span className="text-lg font-bold text-sky-700 dark:text-sky-300 mt-0.5">
                {person.outboundInteractionCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Threads</span>
              <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
                {person.conversationCount}
              </span>
            </div>
            <div className="flex flex-col">
              <span
                className="text-[11px] font-medium text-stone-500"
                title="Recency of interaction: Active (<30d), Slipping (30-60d), Dormant (>60d)"
              >
                Recency
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300 mt-1.5">
                {person.driftStatus}
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 pt-1">
            <button
              type="button"
              onClick={() => setActiveTab("timeline")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                activeTab === "timeline"
                  ? "bg-[#191817] text-white shadow-xs"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
              }`}
            >
              Interaction Timeline
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                activeTab === "details"
                  ? "bg-[#191817] text-white shadow-xs"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
              }`}
            >
              Notes & Memberships
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "timeline" ? (
            <div className="space-y-6">
              <ProfileBreakdown person={person} />

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                    Activity Stream
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    Latest: {formatDate(person.lastInteractionAt)}
                  </span>
                </div>
                <Timeline personId={person.id} personName={person.name} />
              </div>
            </div>
          ) : (
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

        {/* Drawer Footer */}
        <div className="p-4 border-t border-stone-200/80 bg-white dark:bg-stone-900 dark:border-stone-800 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={archive}
            className="text-stone-500 hover:text-destructive hover:bg-destructive/10 text-xs"
          >
            <Archive className="size-3.5 mr-1.5" /> Archive Contact
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Close
          </Button>
        </div>

        <EditContactDialog
          open={isEditingProfile}
          onOpenChange={setIsEditingProfile}
          person={person}
          onPersonUpdated={onPersonUpdated}
          initialFocus={editFocusField}
        />
      </SheetContent>
    </Sheet>
  )
}
