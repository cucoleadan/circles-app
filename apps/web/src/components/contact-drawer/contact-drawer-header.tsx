import { Ban, Edit2, ExternalLink, EyeOff, Plus, Sparkles } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
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
}: {
  person: Person
  allLists: ListRecord[]
  isIgnored: boolean
  onOpenEdit: (focus?: "name" | "handle") => void
  onToggleIgnore: () => void
  onAddToList: (listId: string) => void
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="size-12 border border-stone-200 shadow-2xs dark:border-stone-800 shrink-0">
            {person.avatarUrl && (
              <AvatarImage
                src={person.avatarUrl}
                alt={person.name}
                referrerPolicy="no-referrer"
              />
            )}
            <AvatarFallback className="bg-stone-100 font-bold text-stone-700 text-sm dark:bg-stone-800 dark:text-stone-300">
              {initials(person.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-base font-bold text-stone-900 dark:text-stone-100 truncate">
                {person.name}
              </SheetTitle>
              {person.profileUrl && (
                <a
                  href={person.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                  title="Open Substack profile"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>

            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              {person.handle ? (
                <span className="font-mono text-stone-600 dark:text-stone-300 font-medium">@{person.handle}</span>
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
                className="capitalize text-stone-600 dark:text-stone-400"
                title="Recency: Active (<30d), Slipping (30-60d), Dormant (>60d)"
              >
                {person.driftStatus}
              </span>
            </div>

            {person.lists && person.lists.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {person.lists.map((l) => (
                  <span
                    key={l.id}
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${
                      l.name.toLowerCase() === "ignored"
                        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
                        : "border-stone-200 bg-stone-100/80 text-stone-700 dark:border-stone-800 dark:bg-stone-800/80 dark:text-stone-300"
                    }`}
                  >
                    {l.name.toLowerCase() === "ignored" ? "🚫 Ignored" : l.name}
                  </span>
                ))}
              </div>
            )}

            {/* Follower / Subscriber Audience Chips */}
            {(person.isSubscriber || person.isFollower) && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {person.isFollower && !person.isSubscriber && (
                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
                    👤 Follows · Not Subscribed
                  </span>
                )}
                {person.isSubscriber && (
                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                    📬 {person.subscriptionTier ? `${person.subscriptionTier.toUpperCase()} Subscriber` : "Subscriber"}
                  </span>
                )}
                {person.isFollower && person.isSubscriber && (
                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-400">
                    Follower
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions & Lists */}
        <div className="shrink-0 flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenEdit("name")}
            className="h-8 rounded-full text-xs font-medium px-2.5 gap-1.5 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 hover:text-stone-900 shadow-2xs"
            title="Edit profile details (name, handle, Substack URLs, ID)"
          >
            <Edit2 className="size-3 text-[#f15a3a]" /> Edit
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onToggleIgnore}
            className={`h-8 rounded-full text-xs font-medium px-2.5 gap-1.5 ${
              isIgnored
                ? "text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100"
                : "text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 hover:text-rose-600"
            }`}
            title={isIgnored ? "Remove from Ignored list" : "Ignore from Action Queues"}
          >
            {isIgnored ? (
              <>
                <EyeOff className="size-3.5" /> Ignored
              </>
            ) : (
              <>
                <Ban className="size-3.5" /> Ignore
              </>
            )}
          </Button>

          <Select value="" onValueChange={onAddToList}>
            <SelectTrigger className="h-8 rounded-full text-xs font-medium px-2.5 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 gap-1 w-auto min-w-[70px]">
              <Plus className="size-3" /> List
            </SelectTrigger>
            <SelectContent align="end" className="w-44 text-xs">
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
        </div>
      </div>

      <SheetDescription className="sr-only">
        Contact details and interaction history for {person.name}
      </SheetDescription>

      {/* Engagement Score & Activity Banner */}
      <div className="mt-4 grid grid-cols-5 gap-2 rounded-xl border border-stone-200/80 bg-stone-50 p-2.5 text-center dark:border-stone-800 dark:bg-stone-900">
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
        <div className="flex flex-col">
          <span
            className="text-[11px] font-medium text-stone-500"
            title="Recency of interaction: Active (<30d), Slipping (30-60d), Dormant (>60d)"
          >
            Recency
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300 mt-1.5">
            {person.driftStatus}
          </span>
        </div>
      </div>
    </>
  )
}
