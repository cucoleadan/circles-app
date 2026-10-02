import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react"
import { Check, Plus, Settings2, Tag, Trash2, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import type { NoteTag, NoteTagSummary, ScheduledNote } from "../../lib/notes"

export const TAG_COLORS = [
  "#f15a3a",
  "#f59e0b",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#78716c",
]

export interface NoteTagsApi {
  tags: NoteTagSummary[]
  createTag: (name: string, color?: string) => Promise<NoteTagSummary | null>
  updateTag: (
    id: string,
    patch: { name?: string; color?: string }
  ) => Promise<boolean>
  deleteTag: (id: string) => Promise<boolean>
  setNoteTags: (note: ScheduledNote, tagIds: string[]) => Promise<void>
  openManager: () => void
}

const NoteTagsContext = createContext<NoteTagsApi | null>(null)

export const NoteTagsProvider = NoteTagsContext.Provider

export function useNoteTags(): NoteTagsApi {
  const api = useContext(NoteTagsContext)
  if (!api) throw new Error("useNoteTags needs a NoteTagsProvider")
  return api
}

/** The next palette color, so new tags don't all share one. */
export function nextTagColor(tags: NoteTag[]): string {
  return TAG_COLORS[tags.length % TAG_COLORS.length]!
}

export function NoteTagChip({
  tag,
  onRemove,
}: {
  tag: NoteTag
  onRemove?: () => void
}) {
  return (
    <span
      className="inline-flex min-h-5 max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium text-stone-700 dark:text-stone-200"
      style={{
        borderColor: `${tag.color}55`,
        backgroundColor: `${tag.color}14`,
      }}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="min-w-0 break-words">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${tag.name}`}
          onClick={onRemove}
          className="-mr-0.5 rounded-full p-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100"
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  )
}

/** Searchable tag list that toggles tags and creates new ones by name. */
export function NoteTagPicker({
  selectedIds,
  onChange,
  align = "start",
  children,
}: {
  selectedIds: string[]
  onChange: (tagIds: string[]) => void
  align?: "start" | "center" | "end"
  children: ReactNode
}) {
  const { tags, createTag, openManager } = useNoteTags()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const trimmed = query.trim()
  const exists = tags.some(
    (tag) => tag.name.toLowerCase() === trimmed.toLowerCase()
  )

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((other) => other !== id)
        : [...selectedIds, id]
    )
  }

  async function create() {
    if (!trimmed || creating) return
    setCreating(true)
    const tag = await createTag(trimmed, nextTagColor(tags))
    setCreating(false)
    if (!tag) return
    onChange([...selectedIds, tag.id])
    setQuery("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="z-[70] w-60 p-0">
        <Command>
          <CommandInput
            placeholder="Find or create a tag…"
            value={query}
            onValueChange={setQuery}
            maxLength={60}
          />
          <CommandList>
            {tags.length === 0 && !trimmed && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                Type a name to create your first tag.
              </p>
            )}
            {tags.length > 0 && (
              <CommandGroup>
                {tags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    data-checked={selectedIds.includes(tag.id)}
                    onSelect={() => toggle(tag.id)}
                    className="text-xs"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {trimmed && !exists && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create__ ${trimmed}`}
                  onSelect={() => void create()}
                  disabled={creating}
                  className="text-xs"
                >
                  <Plus /> Create “{trimmed}”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandSeparator alwaysRender />
            <CommandGroup forceMount>
              <CommandItem
                forceMount
                value="__manage__"
                onSelect={() => {
                  setOpen(false)
                  openManager()
                }}
                className="text-xs text-muted-foreground"
              >
                <Settings2 /> Manage tags…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** A Note's tags with an inline picker, for cards and table rows. */
export function NoteTagList({ note }: { note: ScheduledNote }) {
  const { setNoteTags } = useNoteTags()
  const canTag = note.status !== "pending" && note.status !== "deleted"
  if (!canTag && note.tags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {note.tags.map((tag) => (
        <NoteTagChip key={tag.id} tag={tag} />
      ))}
      {canTag && (
        <NoteTagPicker
          selectedIds={note.tags.map((tag) => tag.id)}
          onChange={(ids) => void setNoteTags(note, ids)}
        >
          <button
            type="button"
            aria-label="Edit tags"
            title="Edit tags"
            className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-stone-300 px-1.5 text-[10.5px] text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-800 dark:border-stone-700 dark:hover:text-stone-200"
          >
            {note.tags.length > 0 ? (
              <Plus className="size-2.5" />
            ) : (
              <>
                <Tag className="size-2.5" /> Tag
              </>
            )}
          </button>
        </NoteTagPicker>
      )}
    </div>
  )
}

function ColorPicker({
  color,
  onPick,
  label,
}: {
  color: string
  onPick: (color: string) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800"
        >
          <span
            className="size-3.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[70] w-auto p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {TAG_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use ${swatch}`}
              onClick={() => {
                onPick(swatch)
                setOpen(false)
              }}
              className="flex size-7 items-center justify-center rounded-full ring-offset-2 hover:ring-2 hover:ring-stone-300"
              style={{ backgroundColor: swatch }}
            >
              {swatch === color && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TagRow({ tag }: { tag: NoteTagSummary }) {
  const { updateTag, deleteTag } = useNoteTags()
  const [name, setName] = useState(tag.name)
  const [confirming, setConfirming] = useState(false)

  async function rename() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === tag.name) {
      setName(tag.name)
      return
    }
    if (!(await updateTag(tag.id, { name: trimmed }))) setName(tag.name)
  }

  return (
    <li className="flex items-center gap-2 py-1.5">
      <ColorPicker
        color={tag.color}
        label={`Change the color of ${tag.name}`}
        onPick={(color) => void updateTag(tag.id, { color })}
      />
      <Input
        value={name}
        maxLength={60}
        aria-label={`Rename ${tag.name}`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") setName(tag.name)
        }}
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {tag.count} Note{tag.count === 1 ? "" : "s"}
      </span>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={() => void deleteTag(tag.id)}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
        </span>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${tag.name}`}
          className="shrink-0 text-stone-400 hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  )
}

/** Create, rename, recolor, and delete Note tags. */
export function NoteTagsManager({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { tags, createTag } = useNoteTags()
  const [name, setName] = useState("")
  const [color, setColor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const newColor = color ?? nextTagColor(tags)

  async function add(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    const tag = await createTag(trimmed, newColor)
    setSaving(false)
    if (tag) {
      setName("")
      setColor(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <div className="space-y-1">
          <DialogTitle className="text-sm font-semibold">Note tags</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Tags only live in Circles. Substack never sees them.
          </DialogDescription>
        </div>

        <form onSubmit={add} className="mt-4 flex items-center gap-2">
          <ColorPicker
            color={newColor}
            label="Color for the new tag"
            onPick={setColor}
          />
          <Input
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="New tag (e.g. Growth, Launch, Evergreen)"
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            className="h-8 text-xs"
            disabled={!name.trim() || saving}
          >
            <Plus /> Add
          </Button>
        </form>

        {tags.length === 0 ? (
          <p className="mt-6 mb-2 text-center text-xs text-muted-foreground">
            No tags yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">
            {tags.map((tag) => (
              // Remount on rename from elsewhere so the field shows the new name.
              <TagRow key={`${tag.id}:${tag.name}`} tag={tag} />
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
