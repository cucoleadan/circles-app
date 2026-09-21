import { useState, type SyntheticEvent } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { ListRecord, Person } from "../../lib/types"

export function ContactListsEditor({
  person,
  allLists,
  onPersonUpdated,
  onCreateList,
}: {
  person: Person
  allLists: ListRecord[]
  onPersonUpdated: (updated: Person) => void
  onCreateList?: (name: string) => Promise<ListRecord | void>
}) {
  const [selectedListToAdd, setSelectedListToAdd] = useState<string>("")
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState("")
  const [creatingListLoading, setCreatingListLoading] = useState(false)

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

  const availableLists = allLists.filter(
    (l) => !(person.lists ?? []).some((pl) => pl.id === l.id)
  )

  return (
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
  )
}
