import type { TagRecord } from "../../lib/types"

export function SidebarTagsSection({
  tags,
  selectedTagId,
  onListChange,
  onTagChange,
}: {
  tags: TagRecord[]
  selectedTagId: string | null
  onListChange: (listId: string | null) => void
  onTagChange: (tagId: string | null) => void
}) {
  if (tags.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        Tags
      </p>
      <div className="flex flex-wrap gap-1 px-3">
        {tags.map((t) => {
          const isActive = selectedTagId === t.id
          return (
            <button
              key={t.id}
              type="button"
              title={`Filter by tag: ${t.name}`}
              onClick={() => {
                onListChange(null)
                onTagChange(isActive ? null : t.id)
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all border ${
                isActive
                  ? "ring-2 ring-stone-900 dark:ring-stone-100"
                  : "opacity-80 hover:opacity-100"
              }`}
              style={{
                backgroundColor: t.color ? `${t.color}15` : "#635bff15",
                borderColor: t.color ? `${t.color}40` : "#635bff40",
                color: t.color || "#635bff",
              }}
            >
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: t.color || "#635bff" }}
              />
              <span>{t.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
