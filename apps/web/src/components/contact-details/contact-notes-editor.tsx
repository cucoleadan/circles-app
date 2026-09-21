import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import type { Person } from "../../lib/types"

export function ContactNotesEditor({
  person,
  onPersonUpdated,
}: {
  person: Person
  onPersonUpdated: (updated: Person) => void
}) {
  const [notes, setNotes] = useState(person.notes ?? "")
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

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

  return (
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
  )
}
