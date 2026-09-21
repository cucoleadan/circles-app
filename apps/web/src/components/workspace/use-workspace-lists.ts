import { useState } from "react"
import type { ListRecord, Person } from "../../lib/types"

export function useWorkspaceLists({
  initialLists,
  setPeople,
  selectedListId,
  setSelectedListId,
  updateUrl,
  setNotice,
}: {
  initialLists: ListRecord[]
  setPeople: React.Dispatch<React.SetStateAction<Person[]>>
  selectedListId: string | null
  setSelectedListId: (id: string | null) => void
  updateUrl: (params: Record<string, string | null>) => void
  setNotice: (msg: string | null) => void
}) {
  const [lists, setLists] = useState<ListRecord[]>(initialLists)

  async function handleCreateList(name: string, description?: string | null): Promise<ListRecord | void> {
    try {
      const res = await fetch("/api/v1/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || "Failed to create list")
      }
      const data = await res.json()
      const newList: ListRecord = {
        id: data.list.id,
        name: data.list.name,
        description: description ?? null,
        count: 0,
        createdAt: new Date().toISOString(),
      }
      setLists((prev) => [...prev, newList])
      setNotice(`Created list "${name}"`)
      setTimeout(() => setNotice(null), 3000)
      return newList
    } catch (err: any) {
      setNotice(`Error: ${err.message}`)
      throw err
    }
  }

  async function handleUpdateList(
    listId: string,
    name: string,
    description?: string | null
  ): Promise<ListRecord | void> {
    try {
      const res = await fetch(`/api/v1/lists/${listId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || "Failed to update list")
      }
      const data = await res.json()
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? { ...l, name: data.list.name, description: description !== undefined ? description : l.description }
            : l
        )
      )
      setPeople((prev) =>
        prev.map((p) => ({
          ...p,
          lists: (p.lists ?? []).map((l) => (l.id === listId ? { ...l, name: data.list.name } : l)),
        }))
      )
      setNotice(`Updated list "${data.list.name}"`)
      setTimeout(() => setNotice(null), 3000)
      return data.list
    } catch (err: any) {
      setNotice(`Error: ${err.message}`)
      throw err
    }
  }

  async function handleDeleteList(listId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/v1/lists/${listId}`, { method: "DELETE" })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || "Failed to delete list")
      }
      setLists((prev) => prev.filter((l) => l.id !== listId))
      if (selectedListId === listId) {
        setSelectedListId(null)
        updateUrl({ list: null })
      }
      setPeople((prev) =>
        prev.map((p) => ({
          ...p,
          lists: (p.lists ?? []).filter((l) => l.id !== listId),
        }))
      )
      setNotice("List deleted.")
      setTimeout(() => setNotice(null), 3000)
      return true
    } catch (err: any) {
      setNotice(`Error: ${err.message}`)
      return false
    }
  }

  return {
    lists,
    setLists,
    handleCreateList,
    handleUpdateList,
    handleDeleteList,
  }
}
