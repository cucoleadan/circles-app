import { useState, type SyntheticEvent } from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Textarea } from "@workspace/ui/components/textarea"
import type { ListRecord, Person } from "../lib/types"

export function AddContactDialog({
  open,
  onOpenChange,
  onCreated,
  allLists = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (person: Person) => void
  allLists?: ListRecord[]
}) {
  const [name, setName] = useState("")
  const [handle, setHandle] = useState("")
  const [profileConfirmed, setProfileConfirmed] = useState(false)
  const [notes, setNotes] = useState("")
  const [selectedListId, setSelectedListId] = useState<string>("none")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim() || submitting) return
    if (handle.trim() && !profileConfirmed) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          handle: handle.trim() ? handle.trim().replace(/^@/, "") : null,
          notes: notes.trim() || null,
          relationshipStatus: "active",
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to add person")
      }
      const data = await res.json()
      let createdPerson: Person = data.person

      if (selectedListId && selectedListId !== "none") {
        try {
          const listRes = await fetch(`/api/v1/lists/${selectedListId}/members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ personId: createdPerson.id }),
          })
          if (listRes.ok) {
            const listObj = allLists.find((l) => l.id === selectedListId)
            if (listObj) {
              createdPerson = {
                ...createdPerson,
                lists: [{ id: listObj.id, name: listObj.name, createdAt: new Date().toISOString() }],
              }
            }
          }
        } catch {
          // Non-blocking
        }
      }

      onCreated(createdPerson)
      setName("")
      setHandle("")
      setProfileConfirmed(false)
      setNotes("")
      setSelectedListId("none")
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md p-6 bg-white dark:bg-stone-900">
        <SheetHeader>
          <SheetTitle className="text-lg font-bold">Add Contact</SheetTitle>
          <SheetDescription className="text-xs">
            Add a new relationship to your Circles CRM.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="add-name" className="text-xs font-semibold">
              Full Name *
            </label>
            <Input
              id="add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah Connor"
              required
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="add-handle" className="text-xs font-semibold">
              Substack Handle
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                @
              </span>
              <Input
                id="add-handle"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value.replace(/^@/, ""))
                  setProfileConfirmed(false)
                }}
                placeholder="username"
                className="pl-7 text-xs font-mono"
              />
            </div>
          </div>

          {handle.trim() && (
            <div className="space-y-2 rounded-md border border-stone-200 p-3 text-xs dark:border-stone-700">
              <a
                href={`https://substack.com/@${encodeURIComponent(handle.trim().toLowerCase())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-orange-700 underline dark:text-orange-400"
              >
                Check @{handle.trim()} on Substack ↗
              </a>
              <label className="flex items-start gap-2 text-stone-600 dark:text-stone-300">
                <input
                  type="checkbox"
                  checked={profileConfirmed}
                  onChange={(e) => setProfileConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>This profile belongs to {name.trim() || "this contact"}</span>
              </label>
            </div>
          )}

          {allLists.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Add to List (Optional)</label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select a list…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    (No list)
                  </SelectItem>
                  {allLists.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="add-notes" className="text-xs font-semibold">
              Private Notes
            </label>
            <Textarea
              id="add-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How you met, context, or what to follow up on…"
              className="min-h-24 text-xs"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg">
              {error}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !name.trim() || Boolean(handle.trim() && !profileConfirmed)}
              className="bg-[#191817] hover:bg-[#302e2c] text-white text-xs"
            >
              {submitting ? "Adding…" : "Add Person"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
