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
import type { Person } from "../lib/types"

const statusOptions = [
  { id: "new", label: "New", color: "bg-amber-400" },
  { id: "active", label: "Active", color: "bg-sky-500" },
  { id: "close", label: "Close", color: "bg-emerald-500" },
  { id: "dormant", label: "Dormant", color: "bg-stone-400" },
]

export function AddContactDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (person: Person) => void
}) {
  const [name, setName] = useState("")
  const [handle, setHandle] = useState("")
  const [notes, setNotes] = useState("")
  const [status, setStatus] = useState("new")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim() || submitting) return
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
          relationshipStatus: status,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to add person")
      }
      const data = await res.json()
      onCreated(data.person)
      setName("")
      setHandle("")
      setNotes("")
      setStatus("new")
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
                onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
                placeholder="username"
                className="pl-7 text-xs font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Initial Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-xs">
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
              disabled={submitting || !name.trim()}
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
