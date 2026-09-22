import { Ban, Edit2, ExternalLink, EyeOff, Plus, Sparkles, X } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@workspace/ui/components/select"
import { SheetDescription, SheetTitle } from "@workspace/ui/components/sheet"
import type { ListRecord, Person } from "../../lib/types"

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export function ContactDrawerHeader({
  person,
  allLists,
  isIgnored,
  onOpenEdit,
  onToggleIgnore,
  onAddToList,
  onClose,
}: {
  person: Person
  allLists: ListRecord[]
  isIgnored: boolean
  onOpenEdit: (focus?: "name" | "handle") => void
  onToggleIgnore: () => void
  onAddToList: (listId: string) => void
  onClose?: () => void
}) {
  return (
    <>
      <SheetDescription className="sr-only">
        Contact details and interaction history for {person.name}
      </SheetDescription>

      {/* Row 0: Ultra-compact edge-to-edge top bar with vertical dividers, no button appearance, just padding */}
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-stretch border-b border-stone-200/80 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-950/40 divide-x divide-stone-200/80 dark:divide-stone-800 w-full">
        <button
          type="button"
          onClick={() => onOpenEdit("name")}
          className="flex items-center justify-center gap-1.5 py-1 px-3 h-7 text-[11px] font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100/80 dark:text-stone-300 dark:hover:text-stone-100 dark:hover:bg-stone-800/80 transition-colors w-full select-none"
          title="Edit profile details"
        >
          <Edit2 className="size-3 text-[#f15a3a]" />
          <span>Edit</span>
        </button>

        <button
          type="button"
          onClick={onToggleIgnore}
          className={`flex items-center justify-center gap-1.5 py-1 px-3 h-7 text-[11px] font-medium transition-colors w-full select-none ${
            isIgnored
              ? "text-rose-600 bg-rose-50/70 hover:bg-rose-100 dark:text-rose-400 dark:bg-rose-950/40"
              : "text-stone-600 hover:text-rose-600 hover:bg-stone-100/80 dark:text-stone-300 dark:hover:text-rose-400 dark:hover:bg-stone-800/80"
          }`}
          title={isIgnored ? "Remove from Ignored list" : "Ignore from Action Queues"}
        >
          {isIgnored ? (
            <>
              <EyeOff className="size-3 text-rose-500" />
              <span>Ignored</span>
            </>
          ) : (
            <>
              <Ban className="size-3 text-stone-400" />
              <span>Ignore</span>
            </>
          )}
        </button>

        <Select value="" onValueChange={onAddToList}>
          <SelectTrigger className="flex items-center justify-center gap-1 py-1 px-3 h-7 text-[11px] font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100/80 dark:text-stone-300 dark:hover:text-stone-100 dark:hover:bg-stone-800/80 transition-colors w-full rounded-none border-0 shadow-none ring-0 focus-visible:ring-0 focus-visible:border-0 [&_svg]:size-3 cursor-pointer select-none">
            <Plus className="size-3 text-stone-400" />
            <span>List</span>
          </SelectTrigger>
          <SelectContent align="end" className="w-48 text-xs">
            {allLists.length === 0 ? (
              <SelectItem value="__none__" disabled className="text-xs text-muted-foreground">
                No lists created
              </SelectItem>
            ) : (
              allLists.map((l) => {
                const inList = (person.lists ?? []).some((pl) => pl.id === l.id)
                return (
                  <SelectItem key={l.id} value={l.id} disabled={inList} className="text-xs">
                    {l.name} {inList ? "✓" : ""}
                  </SelectItem>
                )
              })
            )}
          </SelectContent>
        </Select>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center px-2.5 h-7 text-stone-400 hover:text-stone-700 hover:bg-stone-100/80 dark:hover:text-stone-200 dark:hover:bg-stone-800/80 transition-colors shrink-0"
            title="Close drawer"
          >
            <X className="size-3.5" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>

      {/* Profile Details 1-Column Grid (Padded) */}
      <div className="px-6 pt-3.5 pb-1">
        <div className="grid grid-cols-1 gap-3.5">
        {/* Row 1: Flex container aligned at start: image first, then name, below it handle & Active tag */}
        <div className="flex items-start gap-3.5">
          <Avatar className="size-14 border border-stone-200 shadow-2xs dark:border-stone-800 shrink-0 mt-0.5">
            {person.avatarUrl && (
              <AvatarImage
                src={person.avatarUrl}
                alt={person.name}
                referrerPolicy="no-referrer"
              />
            )}
            <AvatarFallback className="bg-stone-100 font-bold text-stone-700 text-base dark:bg-stone-800 dark:text-stone-300">
              {initials(person.name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 flex flex-col">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
                {person.name}
              </SheetTitle>
              {person.profileUrl && (
                <a
                  href={person.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors p-0.5"
                  title="Open Substack profile"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>

            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              {person.handle ? (
                <span className="font-mono text-stone-700 dark:text-stone-300 font-medium text-xs">
                  @{person.handle}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenEdit("handle")}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#f15a3a] hover:underline"
                  title="Add Substack handle"
                >
                  <Plus className="size-3" /> Add handle
                </button>
              )}
              <span>·</span>
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border capitalize ${
                  person.driftStatus === "active"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : person.driftStatus === "slipping"
                    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-400"
                }`}
                title="Recency: Active (<30d), Slipping (30-60d), Dormant (>60d)"
              >
                {person.driftStatus}
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: List and other tags in a row, wrapping across lines if needed */}
        {((person.lists && person.lists.length > 0) ||
          person.isSubscriber ||
          person.isFollower ||
          person.isSubscribedTo ||
          person.isFollowing) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {/* List tags */}
            {person.lists?.map((l) => (
              <span
                key={l.id}
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${
                  l.name.toLowerCase() === "ignored"
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
                    : "border-stone-200 bg-stone-100/90 text-stone-700 dark:border-stone-800 dark:bg-stone-800/90 dark:text-stone-300"
                }`}
              >
                {l.name.toLowerCase() === "ignored" ? "🚫 Ignored" : l.name}
              </span>
            ))}

            {/* Relationship 1-word tags */}
            {person.isSubscriber && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                Subscriber
              </span>
            )}
            {person.isFollower && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
                Follower
              </span>
            )}
            {person.isSubscribedTo && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                Subscribing
              </span>
            )}
            {person.isFollowing && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-stone-100 text-stone-700 border border-stone-200 dark:bg-stone-800 dark:text-stone-300">
                Following
              </span>
            )}
          </div>
        )}

        {/* Row 3: Scoring grid with Recency removed (4 columns) */}
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-stone-200/80 bg-stone-50 p-2.5 text-center dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-stone-500 flex items-center justify-center gap-1">
              <Sparkles className="size-3 text-amber-500" /> Score
            </span>
            <span className="text-lg font-bold text-[#f15a3a] mt-0.5">
              {person.engagementScore}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-stone-500">Received</span>
            <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
              {person.inboundInteractionCount ?? 0}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-stone-500">Given</span>
            <span className="text-lg font-bold text-sky-700 dark:text-sky-300 mt-0.5">
              {person.outboundInteractionCount ?? 0}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-stone-500">Threads</span>
            <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
              {person.conversationCount}
            </span>
          </div>
        </div>
      </div>
      </div>
    </>
  )
}
