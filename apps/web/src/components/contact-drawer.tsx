import { useEffect, useState } from "react"
import {
  Archive,
  ExternalLink,
  Sparkles,
  Tag,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { Textarea } from "@workspace/ui/components/textarea"
import type { ListRecord, Person, TagRecord } from "../lib/types"
import { Timeline } from "./timeline"

const statusOptions = [
  { id: "new", label: "New", color: "bg-amber-400" },
  { id: "active", label: "Active", color: "bg-sky-500" },
  { id: "close", label: "Close", color: "bg-emerald-500" },
  { id: "dormant", label: "Dormant", color: "bg-stone-400" },
]

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
    return d.toLocaleDateString(undefined, {
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
}: {
  person: Person | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPersonUpdated: (updated: Person) => void
  onPersonArchived: (id: string) => void
  allLists: ListRecord[]
  allTags: TagRecord[]
}) {
  if (!person) return null

  const [notes, setNotes] = useState(person.notes ?? "")
  const [status, setStatus] = useState(person.relationshipStatus ?? "new")
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<"timeline" | "details">("timeline")
  const [selectedListToAdd, setSelectedListToAdd] = useState<string>("")
  const [selectedTagToAdd, setSelectedTagToAdd] = useState<string>("")

  useEffect(() => {
    setNotes(person.notes ?? "")
    setStatus(person.relationshipStatus ?? "new")
    setNotesSaved(false)
  }, [person.id, person.notes, person.relationshipStatus])

  async function handleStatusChange(newStatus: string) {
    setStatus(newStatus)
    try {
      const res = await fetch(`/api/v1/people/${person?.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relationshipStatus: newStatus }),
      })
      if (!res.ok) throw new Error("Failed to update status")
      onPersonUpdated({ ...person!, relationshipStatus: newStatus })
    } catch (err) {
      console.error(err)
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    try {
      const res = await fetch(`/api/v1/people/${person?.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error("Failed to save notes")
      onPersonUpdated({ ...person!, notes })
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSavingNotes(false)
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
      setSelectedListToAdd("")
    } catch (err) {
      console.error(err)
    }
  }

  async function removeFromList(listId: string) {
    if (!person) return
    try {
      const res = await fetch(`/api/v1/lists/${listId}/members/${person.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to remove from list")
      const updatedLists = (person.lists ?? []).filter((l) => l.id !== listId)
      onPersonUpdated({ ...person, lists: updatedLists })
    } catch (err) {
      console.error(err)
    }
  }

  async function attachTag(tagId: string) {
    if (!tagId || !person) return
    const targetTag = allTags.find((t) => t.id === tagId)
    if (!targetTag) return
    try {
      const res = await fetch(`/api/v1/tags/${tagId}/people`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: person.id }),
      })
      if (!res.ok) throw new Error("Failed to attach tag")
      const currentTags = person.tags ?? []
      if (!currentTags.some((t) => t.id === tagId)) {
        const updatedTags = [
          ...currentTags,
          { id: tagId, name: targetTag.name, color: targetTag.color },
        ]
        onPersonUpdated({ ...person, tags: updatedTags })
      }
      setSelectedTagToAdd("")
    } catch (err) {
      console.error(err)
    }
  }

  async function detachTag(tagId: string) {
    if (!person) return
    try {
      const res = await fetch(`/api/v1/tags/${tagId}/people/${person.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to detach tag")
      const updatedTags = (person.tags ?? []).filter((t) => t.id !== tagId)
      onPersonUpdated({ ...person, tags: updatedTags })
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

  const availableLists = allLists.filter(
    (l) => !(person.lists ?? []).some((pl) => pl.id === l.id)
  )
  const availableTags = allTags.filter(
    (t) => !(person.tags ?? []).some((pt) => pt.id === t.id)
  )

  const substackUrl =
    person.profileUrl ||
    (person.handle ? `https://substack.com/@${person.handle.replace(/^@/, "")}` : null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-stone-50/95 dark:bg-stone-950 backdrop-blur-md overflow-hidden border-l border-stone-200 dark:border-stone-800"
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-stone-200/80 bg-white/80 dark:bg-stone-900/80 dark:border-stone-800">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar className="size-13 border-2 border-white shadow-xs dark:border-stone-800 shrink-0">
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
                    <span className="font-mono text-stone-500">@{person.handle}</span>
                  ) : (
                    <span>No handle</span>
                  )}
                  <span>·</span>
                  <span className="capitalize">{person.driftStatus}</span>
                </div>
              </div>
            </div>

            {/* Relationship Status Selector */}
            <div className="shrink-0">
              <Select value={status} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8.5 rounded-full text-xs font-semibold px-3 bg-white dark:bg-stone-800 border-stone-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id} className="text-xs">
                      <span className={`inline-block size-2 rounded-full mr-2 ${opt.color}`} />
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Engagement Score & Activity Banner */}
          <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl border border-stone-200/80 bg-stone-50 p-2.5 text-center dark:border-stone-800 dark:bg-stone-900">
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500 flex items-center justify-center gap-1">
                <Sparkles className="size-3 text-amber-500" /> Score
              </span>
              <span className="text-lg font-bold text-[#f15a3a] mt-0.5">
                {person.engagementScore}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Actions</span>
              <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
                {person.interactionCount}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Threads</span>
              <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
                {person.conversationCount}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Status</span>
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
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  Substack Activity
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  Latest: {formatDate(person.lastInteractionAt)}
                </span>
              </div>
              <Timeline personId={person.id} personName={person.name} />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Private Notes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="drawer-notes" className="text-xs font-semibold">
                    Private CRM Notes
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {notesSaved ? (
                      <span className="text-emerald-600 font-medium">✓ Saved</span>
                    ) : (
                      "Only you see this"
                    )}
                  </span>
                </div>
                <Textarea
                  id="drawer-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes about shared interests, past conversations, context…"
                  className="min-h-32 text-xs leading-relaxed bg-white dark:bg-stone-900"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="text-xs"
                >
                  {savingNotes ? "Saving…" : "Save Notes"}
                </Button>
              </div>

              <Separator />

              {/* Lists Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  Lists
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {(person.lists ?? []).map((l) => (
                    <span
                      key={l.id}
                      className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 shadow-2xs"
                    >
                      {l.name}
                      <button
                        type="button"
                        onClick={() => removeFromList(l.id)}
                        className="text-stone-400 hover:text-destructive transition-colors ml-0.5"
                        title={`Remove from ${l.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {(!person.lists || person.lists.length === 0) && (
                    <span className="text-xs text-muted-foreground italic">Not on any list</span>
                  )}
                </div>

                {availableLists.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Select value={selectedListToAdd} onValueChange={addToList}>
                      <SelectTrigger className="h-8 text-xs max-w-56 bg-white dark:bg-stone-900">
                        <SelectValue placeholder="+ Add to list…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLists.map((l) => (
                          <SelectItem key={l.id} value={l.id} className="text-xs">
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Separator />

              {/* Tags Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  <Tag className="size-3.5" /> Tags
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {(person.tags ?? []).map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border shadow-2xs"
                      style={{
                        backgroundColor: t.color ? `${t.color}15` : "#635bff15",
                        borderColor: t.color ? `${t.color}40` : "#635bff40",
                        color: t.color || "#635bff",
                      }}
                    >
                      {t.name}
                      <button
                        type="button"
                        onClick={() => detachTag(t.id)}
                        className="hover:opacity-75 transition-opacity ml-0.5"
                        title={`Remove ${t.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {(!person.tags || person.tags.length === 0) && (
                    <span className="text-xs text-muted-foreground italic">No tags attached</span>
                  )}
                </div>

                {availableTags.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Select value={selectedTagToAdd} onValueChange={attachTag}>
                      <SelectTrigger className="h-8 text-xs max-w-56 bg-white dark:bg-stone-900">
                        <SelectValue placeholder="+ Attach tag…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTags.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">
                            <span
                              className="size-2 rounded-full inline-block mr-1.5"
                              style={{ backgroundColor: t.color || "#635bff" }}
                            />
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Separator />

              {/* Relationship Timestamps */}
              <div className="space-y-2.5 rounded-xl border border-stone-200/80 bg-white/60 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                <h4 className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Key Timestamps
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">First Contact</span>
                    <span className="font-medium text-stone-800 dark:text-stone-200">
                      {formatDate(person.firstInteractedAt || person.createdAt)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Last Conversation</span>
                    <span className="font-medium text-stone-800 dark:text-stone-200">
                      {formatDate(person.lastConversationAt)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Last Inbound (From them)</span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      {formatDate(person.lastInboundAt)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Last Outbound (You)</span>
                    <span className="font-medium text-sky-700 dark:text-sky-400">
                      {formatDate(person.lastOutboundAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
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
      </SheetContent>
    </Sheet>
  )
}
