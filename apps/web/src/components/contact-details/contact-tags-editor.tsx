import { useState } from "react"
import { Tag, X } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { Person, TagRecord } from "../../lib/types"

export function ContactTagsEditor({
  person,
  allTags,
  onPersonUpdated,
}: {
  person: Person
  allTags: TagRecord[]
  onPersonUpdated: (updated: Person) => void
}) {
  const [selectedTagToAdd, setSelectedTagToAdd] = useState<string>("")

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

  const availableTags = allTags.filter(
    (t) => !(person.tags ?? []).some((pt) => pt.id === t.id)
  )

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold flex items-center gap-1.5 text-stone-800 dark:text-stone-200">
        <Tag className="size-3.5 text-stone-500" /> Tags
      </h4>
      <div className="flex flex-wrap gap-1">
        {(person.tags ?? []).map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border shadow-none"
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
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: t.color || "#635bff" }}
                    />
                    {t.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
