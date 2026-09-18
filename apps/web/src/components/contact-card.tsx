import { ArrowUpRight, Clock, MessageSquare, Sparkles } from "lucide-react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import type { Person } from "../lib/types"

const statusColors: Record<string, string> = {
  new: "bg-amber-400",
  active: "bg-sky-500",
  close: "bg-emerald-500",
  dormant: "bg-stone-400",
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  } catch {
    return ""
  }
}

export interface ReciprocityInfo {
  label: string
  sublabel: string
  variant: "amber" | "sky" | "emerald" | "rose" | "violet" | "stone"
  icon: string
}

export function getReciprocityBadge(person: Person): ReciprocityInfo | null {
  const inbound = person.inboundInteractionCount ?? 0
  const outbound = person.outboundInteractionCount ?? 0
  const lastInboundComment = person.lastInboundCommentAt
    ? new Date(person.lastInboundCommentAt).getTime()
    : 0
  const lastOutboundComment = person.lastOutboundCommentAt
    ? new Date(person.lastOutboundCommentAt).getTime()
    : 0
  const lastAction = person.lastActionType
  const lastDir = person.lastActionDirection

  if (inbound === 0 && outbound === 0) {
    return null
  }

  // 1. Comments and replies are the only triggers for "Needs your reply" and "Awaiting response"
  if (lastInboundComment > 0 && lastInboundComment > lastOutboundComment) {
    return {
      label: "Needs your reply",
      sublabel: "Commented last",
      variant: "amber",
      icon: "💬",
    }
  }

  if (lastOutboundComment > 0 && lastOutboundComment > lastInboundComment) {
    return {
      label: "Ball in their court",
      sublabel: "You commented last",
      variant: "sky",
      icon: "📤",
    }
  }

  // 2. If no unreplied comment, check last action type
  if (lastAction === "like") {
    if (lastDir === "inbound") {
      return {
        label: "Liked last",
        sublabel: `${inbound} received`,
        variant: "rose",
        icon: "❤️",
      }
    } else {
      return {
        label: "You liked last",
        sublabel: `${outbound} given`,
        variant: "stone",
        icon: "❤️",
      }
    }
  }

  if (lastAction === "restack") {
    if (lastDir === "inbound") {
      return {
        label: "Restacked last",
        sublabel: `${inbound} received`,
        variant: "violet",
        icon: "🔁",
      }
    } else {
      return {
        label: "You restacked last",
        sublabel: `${outbound} given`,
        variant: "stone",
        icon: "🔁",
      }
    }
  }

  // 3. Mutual circle
  if ((person.conversationCount ?? 0) > 0 || (inbound > 0 && outbound > 0)) {
    return {
      label: "Mutual circle",
      sublabel: `${inbound} in · ${outbound} out`,
      variant: "emerald",
      icon: "🔄",
    }
  }

  // 4. Fallback
  if (inbound > 0) {
    return {
      label: "Interacted last",
      sublabel: `${inbound} received`,
      variant: "stone",
      icon: "⚡️",
    }
  }

  return {
    label: "Outreach given",
    sublabel: `${outbound} given`,
    variant: "stone",
    icon: "📤",
  }
}

export function ContactCard({
  person,
  onSelect,
}: {
  person: Person
  onSelect: (id: string) => void
}) {
  const hasEngagement = (person.engagementScore ?? 0) > 0
  const isHighAdvocate = (person.engagementScore ?? 0) >= 30
  const reciprocity = getReciprocityBadge(person)

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
              <p className="text-xs text-stone-500 font-mono truncate">
                {person.handle ? `@${person.handle}` : "—"}
              </p>
            </div>
          </div>

          {/* Engagement Score Pill */}
          <div
            className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
              isHighAdvocate
                ? "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                : hasEngagement
                  ? "bg-orange-50 text-[#f15a3a] border border-orange-200 dark:bg-orange-950/40 dark:text-orange-300"
                  : "bg-stone-100 text-stone-500 border border-stone-200 dark:bg-stone-800 dark:text-stone-400"
            }`}
            title={`Engagement score: ${person.engagementScore} pts`}
          >
            <Sparkles className="size-3 text-amber-500" />
            <span>{person.engagementScore}</span>
          </div>
        </div>

        {/* Reciprocity State Chip */}
        {reciprocity && (
          <div className="mt-2.5 flex items-center">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold tracking-tight ${
                reciprocity.variant === "amber"
                  ? "bg-amber-100/90 text-amber-900 border border-amber-300/80 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800"
                  : reciprocity.variant === "emerald"
                    ? "bg-emerald-100/90 text-emerald-900 border border-emerald-300/80 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800"
                    : reciprocity.variant === "sky"
                      ? "bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800"
                      : reciprocity.variant === "rose"
                        ? "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                        : reciprocity.variant === "violet"
                          ? "bg-violet-50 text-violet-800 border border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800"
                          : "bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-400"
              }`}
            >
              <span>{reciprocity.icon}</span>
              <span>{reciprocity.label}</span>
              <span className="opacity-60 text-[9.5px] font-normal">
                • {reciprocity.sublabel}
              </span>
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
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 px-2 py-0.5 font-medium">
              <MessageSquare className="size-2.5" />
              {person.conversationCount} threads
            </span>
          )}
          <span className="capitalize text-[10px] text-stone-400 ml-auto">
            {person.driftStatus}
          </span>
        </div>

        {/* Lists Badges */}
        {person.lists && person.lists.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {person.lists.map((l) => (
              <span
                key={l.id}
                className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:text-stone-300"
              >
                {l.name}
              </span>
            ))}
          </div>
        )}

        {/* Notes Snippet */}
        {person.notes && (
          <p className="mt-2.5 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 italic font-serif">
            "{person.notes}"
          </p>
        )}
      </div>

      {/* Card Footer: Recency Timestamp & Explicit Details Button */}
      <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-[11px] text-stone-400">
        <span>
          {person.lastInteractionAt
            ? `Active ${formatDate(person.lastInteractionAt)}`
            : "No recent activity"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onSelect(person.id)
          }}
          className="text-[#f15a3a] hover:text-[#d04325] hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
        >
          Details <ArrowUpRight className="size-3" />
        </button>
      </div>
    </div>
  )
}
