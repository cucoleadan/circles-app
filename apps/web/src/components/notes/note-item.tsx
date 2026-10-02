import {
  CopyPlus,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Zap,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import {
  formatTime,
  noteMoment,
  statusClasses,
  statusLabels,
  type ScheduledNote,
} from "../../lib/notes"

export interface NoteHandlers {
  onEdit: (note: ScheduledNote) => void
  onPostNow: (note: ScheduledNote) => void
  onUnschedule: (note: ScheduledNote) => void
  onDuplicate: (note: ScheduledNote) => void
  onDelete: (note: ScheduledNote) => void
}

export function isOpen(note: ScheduledNote): boolean {
  return note.status === "draft" || note.status === "scheduled"
}

export function NoteStatusBadge({ note }: { note: ScheduledNote }) {
  const label =
    note.status === "scheduled" && note.postNow
      ? "Posting"
      : statusLabels[note.status]
  return (
    <Badge
      variant="outline"
      className={`h-5 rounded-full px-1.5 text-[10px] font-semibold ${statusClasses[note.status]}`}
    >
      {label}
    </Badge>
  )
}

export function NoteActionsMenu({
  note,
  handlers,
}: {
  note: ScheduledNote
  handlers: NoteHandlers
}) {
  const open = isOpen(note)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-stone-500"
          aria-label="Note actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {open && (
          <DropdownMenuItem onSelect={() => handlers.onEdit(note)}>
            <Pencil /> {note.editable ? "Edit" : "Reschedule"}
          </DropdownMenuItem>
        )}
        {open && !note.postNow && (
          <DropdownMenuItem onSelect={() => handlers.onPostNow(note)}>
            <Zap /> Post now
          </DropdownMenuItem>
        )}
        {note.status === "scheduled" && !note.postNow && (
          <DropdownMenuItem onSelect={() => handlers.onUnschedule(note)}>
            <FileText /> Move to drafts
          </DropdownMenuItem>
        )}
        {note.bodyJson != null && (
          <DropdownMenuItem onSelect={() => handlers.onDuplicate(note)}>
            <CopyPlus /> Duplicate
          </DropdownMenuItem>
        )}
        {note.noteUrl && (
          <DropdownMenuItem asChild>
            <a href={note.noteUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open on Substack
            </a>
          </DropdownMenuItem>
        )}
        {open && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => handlers.onDelete(note)}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AttachmentSummary({ note }: { note: ScheduledNote }) {
  const images = note.attachments.filter((item) => item.type === "image").length
  const links = note.attachments.filter((item) => item.type === "link").length
  if (!images && !links) return null
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
      {images > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ImageIcon className="size-3" /> {images}
        </span>
      )}
      {links > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Link2 className="size-3" /> {links}
        </span>
      )}
    </span>
  )
}

/** Compact Note card used by the queue view. */
export function NoteCard({
  note,
  handlers,
}: {
  note: ScheduledNote
  handlers: NoteHandlers
}) {
  const moment = noteMoment(note)
  const thumbnail = note.attachments.find((item) => item.imageUrl)?.imageUrl
  return (
    <article className="group flex gap-3 rounded-xl border border-stone-200/80 bg-white p-3 shadow-2xs transition-colors hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700">
      <div className="w-14 shrink-0 pt-0.5 text-xs font-semibold text-stone-900 tabular-nums dark:text-stone-100">
        {moment ? formatTime(moment) : "—"}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <NoteStatusBadge note={note} />
          {note.origin === "substack" && (
            <Badge
              variant="outline"
              className="h-5 rounded-full px-1.5 text-[10px] text-muted-foreground"
            >
              From Substack
            </Badge>
          )}
          {note.mentions.length > 0 && (
            <span className="truncate text-[11px] text-muted-foreground">
              Mentions{" "}
              {note.mentions.map((mention) => mention.label).join(", ")}
            </span>
          )}
          <AttachmentSummary note={note} />
        </div>
        <button
          type="button"
          onClick={() => (isOpen(note) ? handlers.onEdit(note) : undefined)}
          disabled={!isOpen(note)}
          className="line-clamp-3 block w-full text-left text-[13px] leading-relaxed whitespace-pre-line text-stone-700 disabled:cursor-default dark:text-stone-300"
        >
          {note.bodyText || "(Attachment only)"}
        </button>
      </div>
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          className="size-14 shrink-0 rounded-lg object-cover"
        />
      )}
      <div className="shrink-0">
        <NoteActionsMenu note={note} handlers={handlers} />
      </div>
    </article>
  )
}
