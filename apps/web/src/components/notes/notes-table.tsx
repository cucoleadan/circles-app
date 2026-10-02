import { useMemo, useState } from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, Search } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import {
  formatWhen,
  noteMoment,
  replyRoleLabels,
  statusLabels,
  type NoteStatus,
  type ScheduledNote,
} from "../../lib/notes"
import {
  isOpen,
  NoteActionsMenu,
  NoteStatusBadge,
  type NoteHandlers,
} from "./note-item"
import { NoteTagList } from "./note-tags"

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
  },
})

const columnHelper = createColumnHelper<typeof features, ScheduledNote>()

const columnLabels: Record<string, string> = {
  when: "When",
  status: "Status",
  bodyText: "Note",
  tags: "Tags",
  extras: "Extras",
  replyMinimumRole: "Replies",
  origin: "Source",
  updatedAt: "Last edited",
}

function SortHeader({
  label,
  onToggle,
}: {
  label: string
  onToggle: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="-ml-2 text-[11px] font-semibold"
      onClick={onToggle}
    >
      {label}
      <ArrowUpDown className="size-3" />
    </Button>
  )
}

const PAGE_SIZE = 25

const extraLabels: Record<string, string> = {
  post: "Restack",
  comment: "Quote",
  image: "Image",
  link: "Link",
  video: "Video",
  poll: "Poll",
  live_stream: "Live",
}

/** What a Note carries besides text, e.g. ["Restack", "Image ×2", "Mention"]. */
function noteExtras(note: ScheduledNote): string[] {
  const counts = new Map<string, number>()
  for (const item of note.attachments) {
    if (item.type === "missing") continue
    const label = extraLabels[item.type] ?? item.type.replace(/_/g, " ")
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  if (note.mentions.length) counts.set("Mention", note.mentions.length)
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
}

const ALL_STATUSES: NoteStatus[] = [
  "scheduled",
  "draft",
  "published",
  "pending",
]

export function NotesTable({
  notes,
  handlers,
}: {
  notes: ScheduledNote[]
  handlers: NoteHandlers
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "when", desc: false },
  ])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>({ updatedAt: false })
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [statuses, setStatuses] = useState<NoteStatus[]>([
    "scheduled",
    "draft",
    "published",
    "pending",
  ])

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor(
          (note) => noteMoment(note)?.getTime() ?? Number.MAX_SAFE_INTEGER,
          {
            id: "when",
            sortFn: "basic",
            header: ({ column }) => (
              <SortHeader
                label="When"
                onToggle={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              />
            ),
            cell: ({ row }) => {
              const moment = noteMoment(row.original)
              return (
                <span className="whitespace-nowrap tabular-nums">
                  {moment ? (
                    formatWhen(moment)
                  ) : (
                    <span className="text-muted-foreground">No time</span>
                  )}
                </span>
              )
            },
          }
        ),
        columnHelper.accessor("status", {
          header: ({ column }) => (
            <SortHeader
              label="Status"
              onToggle={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
          ),
          cell: ({ row }) => <NoteStatusBadge note={row.original} />,
        }),
        columnHelper.accessor("bodyText", {
          header: "Note",
          filterFn: "includesString",
          cell: ({ row }) => {
            const note = row.original
            const text = note.bodyText.replace(/\s+/g, " ") || "(Attachment only)"
            const className =
              "block max-w-[28rem] cursor-pointer truncate text-left hover:underline disabled:cursor-default disabled:no-underline"
            // Published Notes can't be edited upstream; open them on Substack instead.
            return !isOpen(note) && note.noteUrl ? (
              <a
                href={note.noteUrl}
                target="_blank"
                rel="noreferrer"
                className={className}
                title={note.bodyText}
              >
                {text}
              </a>
            ) : (
              <button
                type="button"
                disabled={!isOpen(note)}
                onClick={() => handlers.onEdit(note)}
                className={className}
                title={note.bodyText}
              >
                {text}
              </button>
            )
          },
        }),
        columnHelper.accessor(
          (note) => note.tags.map((tag) => tag.name).join(", "),
          {
            id: "tags",
            sortFn: "text",
            header: ({ column }) => (
              <SortHeader
                label="Tags"
                onToggle={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              />
            ),
            cell: ({ row }) => (
              <div className="min-w-24">
                <NoteTagList note={row.original} />
              </div>
            ),
          }
        ),
        columnHelper.accessor((note) => noteExtras(note).join(", "), {
          id: "extras",
          header: "Extras",
          cell: ({ row }) => {
            const extras = noteExtras(row.original)
            const mentioned = row.original.mentions
              .map((mention) => mention.label)
              .join(", ")
            return extras.length ? (
              <div className="flex flex-wrap gap-1">
                {extras.map((label) => {
                  const badge = (
                    <Badge
                      key={label}
                      variant="outline"
                      className="h-5 rounded-full px-1.5 text-[10px] whitespace-nowrap capitalize"
                    >
                      {label}
                    </Badge>
                  )
                  return label.startsWith("Mention") ? (
                    <Tooltip key={label}>
                      <TooltipTrigger asChild>{badge}</TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {mentioned}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    badge
                  )
                })}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          },
        }),
        columnHelper.accessor("replyMinimumRole", {
          header: "Replies",
          cell: ({ row }) => (
            <span className="whitespace-nowrap">
              {replyRoleLabels[row.original.replyMinimumRole] ?? "Everyone"}
            </span>
          ),
        }),
        columnHelper.accessor("origin", {
          header: ({ column }) => (
            <SortHeader
              label="Source"
              onToggle={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
          ),
          cell: ({ row }) => (
            <Badge
              variant="outline"
              className="h-5 rounded-full px-1.5 text-[10px] text-muted-foreground"
            >
              {row.original.origin === "substack" ? "Substack" : "Circles"}
            </Badge>
          ),
        }),
        columnHelper.accessor("updatedAt", {
          header: ({ column }) => (
            <SortHeader
              label="Last edited"
              onToggle={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
          ),
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-muted-foreground tabular-nums">
              {formatWhen(new Date(row.original.updatedAt))}
            </span>
          ),
        }),
        columnHelper.display({
          id: "actions",
          enableHiding: false,
          cell: ({ row }) => (
            <NoteActionsMenu note={row.original} handlers={handlers} />
          ),
        }),
      ]),
    [handlers]
  )

  const data = useMemo(
    () => notes.filter((note) => statuses.includes(note.status)),
    [notes, statuses]
  )

  const table = useTable({
    features,
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    state: { sorting, columnFilters, columnVisibility, pagination },
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter Notes…"
            value={
              (table.getColumn("bodyText")?.getFilterValue() as string) ?? ""
            }
            onChange={(event) =>
              table.getColumn("bodyText")?.setFilterValue(event.target.value)
            }
            className="h-8 bg-white pl-8 text-xs dark:bg-stone-950"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Status <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_STATUSES.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={statuses.includes(status)}
                onCheckedChange={(checked) =>
                  setStatuses((prev) =>
                    checked
                      ? [...prev, status]
                      : prev.filter((item) => item !== status)
                  )
                }
                onSelect={(event) => event.preventDefault()}
              >
                {statusLabels[status]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Columns <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {columnLabels[column.id] ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rows scroll inside the Table's own container, so the page's view
          tabs, this toolbar and the sticky column header stay in view. */}
      <div className="overflow-hidden rounded-xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900 [&>[data-slot=table-container]]:max-h-[max(20rem,calc(100svh-17rem))]">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-10 bg-stone-50 shadow-[inset_0_-1px_0_rgb(231_229_228)] dark:bg-stone-950 dark:shadow-[inset_0_-1px_0_rgb(41_37_36)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-8 border-r border-stone-200/70 text-[11px] last:border-r-0 dark:border-stone-800"
                  >
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="border-r border-stone-200/70 py-1.5 last:border-r-0 dark:border-stone-800"
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-20 text-center text-muted-foreground"
                >
                  No Notes match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Showing {table.getRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} Note
          {table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
        </span>
        {table.getCanNextPage() && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPagination({
                pageIndex: 0,
                pageSize: pagination.pageSize + PAGE_SIZE,
              })
            }
          >
            Load more
          </Button>
        )}
      </div>
    </div>
  )
}
