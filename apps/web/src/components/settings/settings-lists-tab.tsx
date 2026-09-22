import { useState, type SyntheticEvent } from "react"
import {
  AlertCircle,
  Bookmark,
  Edit2,
  EyeOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import type { ListRecord } from "../../lib/types"

import { SettingsDeleteListDialog } from "./settings-delete-list-dialog"

export function SettingsListsTab({
  lists,
  onCreateList,
  onUpdateList,
  onDeleteList,
}: {
  lists: ListRecord[]
  onCreateList?: (name: string, description?: string | null) => Promise<ListRecord | void>
  onUpdateList?: (listId: string, name: string, description?: string | null) => Promise<ListRecord | void>
  onDeleteList?: (listId: string) => Promise<boolean>
}) {
  const [newListName, setNewListName] = useState("")
  const [newListDesc, setNewListDesc] = useState("")
  const [creatingList, setCreatingList] = useState(false)
  const [createListError, setCreateListError] = useState<string | null>(null)

  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [editingDesc, setEditingDesc] = useState("")
  const [updatingList, setUpdatingList] = useState(false)
  const [updateListError, setUpdateListError] = useState<string | null>(null)

  const [deletingList, setDeletingList] = useState<ListRecord | null>(null)
  const [isDeletingList, setIsDeletingList] = useState(false)
  const [listSearch, setListSearch] = useState("")

  async function handleCreateListSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = newListName.trim()
    if (!trimmed || creatingList || !onCreateList) return
    setCreatingList(true)
    setCreateListError(null)
    try {
      await onCreateList(trimmed, newListDesc.trim() || null)
      setNewListName("")
      setNewListDesc("")
    } catch (err: any) {
      setCreateListError(err?.message || "Failed to create list")
    } finally {
      setCreatingList(false)
    }
  }

  function startEditingList(list: ListRecord) {
    setEditingListId(list.id)
    setEditingName(list.name)
    setEditingDesc(list.description || "")
    setUpdateListError(null)
  }

  function cancelEditingList() {
    setEditingListId(null)
    setEditingName("")
    setEditingDesc("")
    setUpdateListError(null)
  }

  async function handleUpdateListSubmit(listId: string) {
    const trimmed = editingName.trim()
    if (!trimmed || updatingList || !onUpdateList) return
    setUpdatingList(true)
    setUpdateListError(null)
    try {
      await onUpdateList(listId, trimmed, editingDesc.trim() || null)
      setEditingListId(null)
    } catch (err: any) {
      setUpdateListError(err?.message || "Failed to update list")
    } finally {
      setUpdatingList(false)
    }
  }

  async function handleDeleteListConfirm() {
    if (!deletingList || isDeletingList || !onDeleteList) return
    setIsDeletingList(true)
    try {
      const ok = await onDeleteList(deletingList.id)
      if (ok) {
        setDeletingList(null)
      }
    } finally {
      setIsDeletingList(false)
    }
  }

  const filteredLists = lists.filter((l) => {
    if (!listSearch.trim()) return true
    const term = listSearch.toLowerCase()
    return (
      l.name.toLowerCase().includes(term) ||
      (l.description && l.description.toLowerCase().includes(term))
    )
  })

  return (
    <div className="space-y-3">
      {/* Info banner */}
      <div className="rounded border border-stone-200/80 bg-white p-3 shadow-none dark:border-stone-800 dark:bg-stone-900 text-stone-600 dark:text-stone-400 text-xs space-y-1">
        <div className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
          <Bookmark className="size-3.5 text-[#f15a3a]" />
          <span>Contact Lists &amp; Cohorts</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          Lists help you organize your contacts into meaningful groups (such as Mentors, VIPs, or Ignored). Deleting a list unlinks contacts, but <strong>never deletes contacts or their interactions</strong>.
        </p>
      </div>

      {/* Create New List Card */}
      <div className="rounded border border-stone-200/80 bg-white p-3.5 shadow-none dark:border-stone-800 dark:bg-stone-900 space-y-2.5">
        <div className="flex items-center gap-2">
          <Plus className="size-3.5 text-[#f15a3a]" />
          <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
            Create New List
          </h3>
        </div>

        <form onSubmit={handleCreateListSubmit} className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              List Name <span className="text-rose-500">*</span>
            </label>
            <Input
              value={newListName}
              onChange={(e) => {
                setNewListName(e.target.value)
                setCreateListError(null)
              }}
              placeholder="e.g. VIPs, Collaborators, Advisers…"
              className="text-xs h-8 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              Description <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <Input
              value={newListDesc}
              onChange={(e) => setNewListDesc(e.target.value)}
              placeholder="e.g. Key relationships to check in with monthly…"
              className="text-xs h-8 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded"
            />
          </div>

          {createListError && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-medium">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{createListError}</span>
            </div>
          )}

          <div className="flex justify-end pt-0.5">
            <Button
              type="submit"
              size="sm"
              disabled={creatingList || !newListName.trim()}
              className="text-xs font-semibold bg-[#f15a3a] hover:bg-[#d94827] text-white h-7.5 px-3 rounded shadow-xs"
            >
              <Plus className="size-3.5 mr-1" />
              {creatingList ? "Creating…" : "Create List"}
            </Button>
          </div>
        </form>
      </div>

      {/* Lists Inventory */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
              Your Lists
            </h3>
            <span className="rounded bg-stone-200/80 dark:bg-stone-800 px-1.5 py-0.2 text-[10px] font-semibold text-stone-700 dark:text-stone-300">
              {lists.length}
            </span>
          </div>

          {lists.length > 2 && (
            <div className="relative w-44">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-stone-400" />
              <Input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Search lists…"
                className="pl-7 h-7 text-[11px] bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded"
              />
            </div>
          )}
        </div>

        {filteredLists.length === 0 ? (
          <div className="rounded border border-dashed border-stone-200 dark:border-stone-800 p-5 text-center text-stone-400">
            <Bookmark className="size-5 mx-auto mb-1.5 text-stone-300 dark:text-stone-700" />
            <p className="text-xs font-medium">
              {lists.length === 0 ? "No lists created yet" : "No lists matching your search"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {lists.length === 0 ? "Create your first list above to organize contacts." : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredLists.map((l) => {
              const isIgnored = l.name.toLowerCase() === "ignored"
              const isEditing = editingListId === l.id

              if (isEditing) {
                return (
                  <div
                    key={l.id}
                    className="rounded border border-[#f15a3a]/40 bg-white p-3 shadow-none dark:border-[#f15a3a]/40 dark:bg-stone-900 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                        <Edit2 className="size-3.5 text-[#f15a3a]" /> Edit List
                      </span>
                      <button
                        type="button"
                        onClick={cancelEditingList}
                        className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <div>
                        <label className="block text-[10.5px] font-semibold text-stone-500 mb-0.5">
                          List Name
                        </label>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="text-xs h-7.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-semibold text-stone-500 mb-0.5">
                          Description
                        </label>
                        <Input
                          value={editingDesc}
                          onChange={(e) => setEditingDesc(e.target.value)}
                          className="text-xs h-7.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded"
                        />
                      </div>
                    </div>

                    {updateListError && (
                      <p className="text-[11px] text-rose-500 font-medium">
                        {updateListError}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-0.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={updatingList}
                        onClick={cancelEditingList}
                        className="h-7 text-xs px-2.5 rounded"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={updatingList || !editingName.trim()}
                        onClick={() => handleUpdateListSubmit(l.id)}
                        className="h-7 text-xs px-3 bg-[#191817] hover:bg-[#302e2c] text-white rounded font-semibold"
                      >
                        {updatingList ? "Saving…" : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={l.id}
                  className="group rounded border border-stone-200/80 bg-white p-2.5 shadow-none hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 transition-all flex items-start justify-between gap-2.5"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isIgnored ? (
                        <EyeOff className="size-3.5 text-rose-500 shrink-0" />
                      ) : (
                        <Bookmark className="size-3.5 text-[#f15a3a]" />
                      )}
                      <span className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-[13px]">
                        {l.name}
                      </span>
                      {isIgnored && (
                        <span className="rounded bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.2 text-[9.5px] font-bold dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                          Excluded from Queues
                        </span>
                      )}
                      <span className="rounded bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700 px-1.5 py-0.2 text-[9.5px] font-semibold">
                        {l.count} {l.count === 1 ? "contact" : "contacts"}
                      </span>
                    </div>

                    {l.description && (
                      <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-2 pl-5">
                        {l.description}
                      </p>
                    )}

                    <p className="text-[10px] text-stone-400 dark:text-stone-500 pl-5">
                      Created {new Date(l.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditingList(l)}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:text-stone-200 dark:hover:bg-stone-800 transition-colors"
                      title="Edit list name or description"
                    >
                      <Edit2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingList(l)}
                      className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/30 transition-colors"
                      title="Delete list"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Delete List Confirmation Modal */}
      <SettingsDeleteListDialog
        list={deletingList}
        isDeleting={isDeletingList}
        onConfirm={handleDeleteListConfirm}
        onCancel={() => setDeletingList(null)}
      />
    </div>
  )
}
