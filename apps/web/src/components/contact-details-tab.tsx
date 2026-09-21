import { useEffect, useState, type SyntheticEvent } from "react"
import { Edit2, ExternalLink, Globe, Plus, Tag, User, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import type { ListRecord, Person, TagRecord } from "../lib/types"

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

export function ContactDetailsTab({
  person,
  allLists,
  allTags,
  onPersonUpdated,
  onCreateList,
  onOpenEditProfile,
}: {
  person: Person
  allLists: ListRecord[]
  allTags: TagRecord[]
  onPersonUpdated: (updated: Person) => void
  onCreateList?: (name: string) => Promise<ListRecord | void>
  onOpenEditProfile?: () => void
}) {
  const [notes, setNotes] = useState(person.notes ?? "")
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [selectedListToAdd, setSelectedListToAdd] = useState<string>("")
  const [selectedTagToAdd, setSelectedTagToAdd] = useState<string>("")
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState("")
  const [creatingListLoading, setCreatingListLoading] = useState(false)

  useEffect(() => {
    setNotes(person.notes ?? "")
    setNotesSaved(false)
  }, [person.id, person.notes])

  async function saveNotes() {
    setSavingNotes(true)
    try {
      const res = await fetch(`/api/v1/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error("Failed to save notes")
      onPersonUpdated({ ...person, notes })
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSavingNotes(false)
    }
  }

  async function addToList(listId: string) {
    if (!listId) return
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

  async function handleCreateAndAddList(e?: SyntheticEvent<HTMLFormElement>) {
    if (e) e.preventDefault()
    const trimmed = newListName.trim()
    if (!trimmed || creatingListLoading) return
    setCreatingListLoading(true)
    try {
      let createdList: { id: string; name: string } | null = null
      if (onCreateList) {
        const result = await onCreateList(trimmed)
        if (result && "id" in result) {
          createdList = result
        }
      }
      if (!createdList) {
        const res = await fetch("/api/v1/lists", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        })
        if (!res.ok) throw new Error("Failed to create list")
        const data = await res.json()
        createdList = data.list
      }

      if (createdList) {
        await addToList(createdList.id)
      }
      setNewListName("")
      setIsCreatingList(false)
    } catch (err) {
      console.error("Error creating and adding list:", err)
    } finally {
      setCreatingListLoading(false)
    }
  }

  async function removeFromList(listId: string) {
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
    if (!tagId) return
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

  const availableLists = allLists.filter(
    (l) => !(person.lists ?? []).some((pl) => pl.id === l.id)
  )
  const availableTags = allTags.filter(
    (t) => !(person.tags ?? []).some((pt) => pt.id === t.id)
  )

  return (
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
        <h4 className="text-xs font-semibold flex items-center gap-1.5">Lists</h4>
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

        {isCreatingList ? (
          <form onSubmit={handleCreateAndAddList} className="flex items-center gap-2 pt-1">
            <Input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="List name (e.g. VIP, Ignored, Follow-up)..."
              className="h-8 text-xs max-w-64 bg-white dark:bg-stone-900"
              autoFocus
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 text-xs px-2.5"
              disabled={!newListName.trim() || creatingListLoading}
            >
              {creatingListLoading ? "Adding…" : "Add"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs px-2"
              onClick={() => {
                setIsCreatingList(false)
                setNewListName("")
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            {availableLists.length > 0 && (
              <Select
                value={selectedListToAdd}
                onValueChange={(val) => {
                  if (val === "__create_new__") {
                    setIsCreatingList(true)
                  } else {
                    addToList(val)
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs max-w-56 bg-white dark:bg-stone-900">
                  <SelectValue placeholder="+ Add to list…" />
                </SelectTrigger>
                <SelectContent>
                  {availableLists.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">
                      {l.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__create_new__" className="text-xs font-medium text-primary">
                    + Create New List…
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => setIsCreatingList(true)}
            >
              <Plus className="size-3" /> New List
            </Button>
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

      {/* Profile & Substack Identity */}
      <div className="space-y-3 rounded-xl border border-stone-200/80 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
            <User className="size-3.5 text-stone-500" /> Profile & Substack Info
          </h4>
          {onOpenEditProfile && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenEditProfile}
              className="h-7 text-[11px] px-2 gap-1 border-stone-200 dark:border-stone-700 hover:text-[#f15a3a]"
            >
              <Edit2 className="size-3 text-[#f15a3a]" /> Edit Profile
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="rounded-lg bg-stone-50/80 dark:bg-stone-950/40 p-2.5 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Substack Handle
            </span>
            <div className="mt-0.5 font-mono text-stone-800 dark:text-stone-200 truncate">
              {person.handle ? (
                `@${person.handle}`
              ) : (
                <span className="text-muted-foreground italic font-sans">None set</span>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-stone-50/80 dark:bg-stone-950/40 p-2.5 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Substack Profile ID
            </span>
            <div className="mt-0.5 font-mono text-stone-800 dark:text-stone-200 truncate">
              {person.substackProfileId || (
                <span className="text-muted-foreground italic font-sans">None</span>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-stone-50/80 dark:bg-stone-950/40 p-2.5 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Profile URL
            </span>
            <div className="mt-0.5 truncate">
              {person.profileUrl ? (
                <a
                  href={person.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-700 dark:text-stone-300 hover:text-[#f15a3a] inline-flex items-center gap-1"
                >
                  <span className="truncate max-w-[180px]">{person.profileUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-muted-foreground italic">None</span>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-stone-50/80 dark:bg-stone-950/40 p-2.5 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Publication URL
            </span>
            <div className="mt-0.5 truncate">
              {person.publicationUrl ? (
                <a
                  href={person.publicationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-700 dark:text-stone-300 hover:text-[#f15a3a] inline-flex items-center gap-1"
                >
                  <Globe className="size-3 shrink-0 text-stone-400" />
                  <span className="truncate max-w-[170px]">{person.publicationUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-muted-foreground italic">None</span>
              )}
            </div>
          </div>
        </div>
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
  )
}
