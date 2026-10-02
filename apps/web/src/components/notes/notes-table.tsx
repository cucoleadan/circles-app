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
  AttachmentSummary,
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
  mentions: "Mentions",
  attachments: "Attachments",
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
    pageSize: 25,
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
          cell: ({ row }) => (
            <button
              type="button"
              disabled={!isOpen(row.original)}
              onClick={() => handlers.onEdit(row.original)}
              className="block max-w-[28rem] truncate text-left disabled:cursor-default"
              title={row.original.bodyText}
            >
              {row.original.bodyText.replace(/\s+/g, " ") ||
                "(Attachment only)"}
            </button>
          ),
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
        columnHelper.accessor(
          (note) => note.mentions.map((mention) => mention.label).join(", "),
          {
            id: "mentions",
            header: "Mentions",
            cell: ({ getValue }) => (
              <span className="block max-w-40 truncate text-muted-foreground">
                {String(getValue() || "—")}
              </span>
            ),
          }
        ),
        columnHelper.accessor((note) => note.attachments.length, {
          id: "attachments",
          header: "Attachments",
          cell: ({ row }) =>
            row.original.attachments.length ? (
              <AttachmentSummary note={row.original} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
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

      <div className="overflow-x-auto rounded-xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900">
        <Table className="text-xs">
          <TableHeader className="bg-stone-50 dark:bg-stone-950">
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
          {table.getFilteredRowModel().rows.length} Note
          {table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page {pagination.pageIndex + 1} of{" "}
            {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
