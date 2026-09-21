import { useState, type SyntheticEvent } from "react"
import { Bookmark, Check, EyeOff, Plus, Settings } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import type { ListRecord } from "../../lib/types"

export function SidebarListsSection({
  lists,
  selectedListId,
  onListChange,
  onTagChange,
  onCreateList,
  onOpenSettings,
}: {
  lists: ListRecord[]
  selectedListId: string | null
  onListChange: (listId: string | null) => void
  onTagChange: (tagId: string | null) => void
  onCreateList: (name: string) => Promise<ListRecord | void>
  onOpenSettings?: (tab?: "connection" | "queue" | "extension" | "lists") => void
}) {
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState("")
  const [submittingList, setSubmittingList] = useState(false)

  async function handleCreateList(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = newListName.trim()
    if (!trimmed || submittingList) return
    setSubmittingList(true)
    try {
      await onCreateList(trimmed)
      setNewListName("")
      setIsCreatingList(false)
    } finally {
      setSubmittingList(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Lists
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpenSettings?.("lists")}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors p-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
            title="Manage lists"
          >
            <Settings className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingList((prev) => !prev)}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors p-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
            title="Create list"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {isCreatingList && (
        <form onSubmit={handleCreateList} className="px-3 pt-1 flex items-center gap-1.5">
          <Input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="List name…"
            className="h-7 text-xs"
            autoFocus
          />
          <Button
            type="submit"
            size="sm"
            disabled={submittingList || !newListName.trim()}
            className="h-7 px-2 text-xs"
          >
            <Check className="size-3" />
          </Button>
        </form>
      )}

      <div className="space-y-0.5">
        {lists.map((l) => {
          const isActive = selectedListId === l.id
          const isIgnored = l.name.toLowerCase() === "ignored"
          return (
            <button
              key={l.id}
              type="button"
              title={`Filter by list: ${l.name} (${l.count} ${l.count === 1 ? "contact" : "contacts"})${
                isIgnored ? " · Excluded from Action Queues" : ""
              }`}
              onClick={() => {
                onTagChange(null)
                onListChange(isActive ? null : l.id)
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                isActive
                  ? isIgnored
                    ? "bg-rose-100 font-semibold text-rose-900 dark:bg-rose-950/60 dark:text-rose-200"
                    : "bg-stone-200/80 font-semibold text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                  : isIgnored
                    ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/60"
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {isIgnored ? (
                  <EyeOff className="size-3.5 text-rose-500 shrink-0" />
                ) : (
                  <Bookmark className="size-3.5 text-stone-400 shrink-0" />
                )}
                <span className="truncate">{l.name}</span>
              </div>
              <span className={`text-[11px] shrink-0 ${isIgnored ? "text-rose-400" : "text-stone-400"}`}>
                {l.count}
              </span>
            </button>
          )
        })}
        {lists.length === 0 && (
          <p className="px-3 text-xs text-stone-400 italic">No lists created yet</p>
        )}
      </div>
    </div>
  )
}
