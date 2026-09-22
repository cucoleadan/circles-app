import { ArrowDownLeft, ArrowUpRight, Bookmark, Clock, MessageSquare } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import type { Person } from "../lib/types"
import {
  formatDate,
  getPriorityReason,
  getReciprocityBadge,
  initials,
  ReciprocityBadgePill,
  type ReciprocityInfo,
  statusColors,
} from "./contact-card/contact-card-badges"

export { formatDate, getPriorityReason, getReciprocityBadge, initials, statusColors }
export type { ReciprocityInfo }

export function ContactCard({
  person,
  onSelect,
  currentView,
}: {
  person: Person
  onSelect: (id: string) => void
  currentView?: string
}) {
  const hasEngagement = (person.engagementScore ?? 0) > 0
  const isHighAdvocate = (person.engagementScore ?? 0) >= 30
  const reciprocity = getReciprocityBadge(person)
  const priorityReason = getPriorityReason(person)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(person.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect(person.id)
        }
      }}
      className="group cursor-pointer rounded-2xl border border-stone-200/90 bg-white p-4 transition-colors hover:border-[#f15a3a]/60 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-[#f15a3a]/60 flex flex-col justify-between select-none focus:outline-none focus:ring-2 focus:ring-[#f15a3a]/30 shadow-2xs"
    >
      <div>
        {/* Card Header: Avatar, Name, Handle, Score */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <Avatar className="size-10 border border-stone-100 shadow-2xs dark:border-stone-800">
                {person.avatarUrl && (
                  <AvatarImage
                    src={person.avatarUrl}
                    alt={person.name}
                    referrerPolicy="no-referrer"
                  />
                )}
                <AvatarFallback className="bg-stone-100 font-semibold text-stone-700 text-xs dark:bg-stone-800 dark:text-stone-300">
                  {initials(person.name)}
                </AvatarFallback>
              </Avatar>
              <span
                className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white dark:border-stone-900 ${
                  statusColors[person.relationshipStatus ?? "new"] ?? "bg-stone-400"
                }`}
                title={`Status: ${person.relationshipStatus ?? "new"}`}
              />
            </div>

            <div className="min-w-0">
              <p className="font-bold text-sm tracking-tight text-stone-900 dark:text-stone-100 truncate group-hover:text-[#f15a3a] transition-colors">
                {person.name}
              </p>
              {person.handle ? (
                <p className="text-xs text-muted-foreground truncate font-mono">
                  @{person.handle}
                </p>
              ) : (
                <p className="text-xs text-stone-400 truncate italic">
                  Substack profile
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                hasEngagement
                  ? isHighAdvocate
                    ? "bg-[#f15a3a] text-white shadow-2xs"
                    : "bg-[#f15a3a]/10 text-[#f15a3a] dark:bg-[#f15a3a]/20"
                  : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
              }`}
              title="Calculated relationship score"
            >
              {person.engagementScore ?? 0} pts
            </span>

            {person.driftStatus === "drifting" && (
              <span
                className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50 px-1.5 py-0.2 text-[9px] font-medium"
                title="Drifting supporter: No touch in 21+ days"
              >
                Drifting
              </span>
            )}
            {person.driftStatus === "cold" && (
              <span
                className="rounded-full bg-stone-100 text-stone-500 border border-stone-200 dark:bg-stone-800 dark:text-stone-400 px-1.5 py-0.2 text-[9px] font-medium"
                title="Cold: No touch in 90+ days"
              >
                Cold
              </span>
            )}
          </div>
        </div>

        {/* Audience relationship badges */}
        {(person.isFollower || person.isSubscriber || person.isFollowing || person.isSubscribedTo) && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {person.isFollower && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800 shadow-2xs"
                title="Follows you on Substack"
              >
                <span>Follows you</span>
              </span>
            )}
            {person.isSubscriber && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 shadow-2xs"
                title={person.subscriptionTier ? `Subscriber (${person.subscriptionTier})` : "Publication Subscriber"}
              >
                <span>Subscribed to you</span>
              </span>
            )}
            {person.isFollowing && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-400"
                title="You follow this person on Substack"
              >
                <span>You follow</span>
              </span>
            )}
            {person.isSubscribedTo && (
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                <span>You subscribe</span>
              </span>
            )}
          </div>
        )}

        {/* Reciprocity State Chip */}
        <ReciprocityBadgePill reciprocity={reciprocity} />

        {/* Priority Reason Highlight */}
        {priorityReason && currentView === "priority" && (
          <div className="mt-2 flex items-center">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-orange-50 border border-orange-200 dark:bg-orange-950/40 dark:border-orange-900/50 px-2 py-0.5 text-[10.5px] font-medium text-[#c43e22] dark:text-orange-300">
              <span>{priorityReason.icon}</span>
              <span>{priorityReason.label}</span>
            </span>
          </div>
        )}

        {/* Middle: Metrics and Tags */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
          <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 font-medium">
            <Clock className="size-2.5 text-stone-400" />
            {person.interactionCount} actions
          </span>
          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            {person.inboundInteractionCount ?? 0} received
          </span>
          <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
            {person.outboundInteractionCount ?? 0} given
          </span>
          {(person.conversationCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              <MessageSquare className="size-2.5" />
              {person.conversationCount} convos
            </span>
          )}
          {(person.restackCount ?? 0) > 0 && (
            <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
              🔁 {person.restackCount}
            </span>
          )}
        </div>

        {/* Timestamps */}
        <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
          <span className="flex items-center gap-1" title="Last interaction heard from them">
            <ArrowDownLeft className="size-3 text-emerald-600 dark:text-emerald-400" />
            {formatDate(person.lastInboundAt) || "Never"}
          </span>
          <span className="flex items-center gap-1" title="Last outreach interaction given by you">
            <ArrowUpRight className="size-3 text-sky-600 dark:text-sky-400" />
            {formatDate(person.lastOutboundAt) || "Never"}
          </span>
        </div>

        {/* Relationship Status Note / Preview */}
        {person.notes && (
          <p className="mt-2 text-xs text-stone-600 dark:text-stone-300 italic line-clamp-1 bg-stone-50/80 dark:bg-stone-950/50 px-2 py-1 rounded-md border border-stone-100 dark:border-stone-800">
            "{person.notes}"
          </p>
        )}
      </div>

      {/* Card Footer: Lists and Tags */}
      {((person.lists && person.lists.length > 0) || (person.tags && person.tags.length > 0)) && (
        <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800/80 flex flex-wrap items-center gap-1">
          {(person.lists ?? []).map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-md bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-300"
            >
              <Bookmark className="size-2.5 text-stone-400" />
              {l.name}
            </span>
          ))}

          {(person.tags ?? []).map((t) => (
            <span
              key={t.id}
              className="rounded-full px-1.5 py-0.2 text-[9.5px] font-medium"
              style={{
                backgroundColor: t.color ? `${t.color}15` : "#635bff15",
                color: t.color || "#635bff",
              }}
            >
              #{t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
