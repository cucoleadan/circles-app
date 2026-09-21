import type { Person } from "../../lib/types"

export const statusColors: Record<string, string> = {
  new: "bg-amber-400",
  active: "bg-sky-500",
  close: "bg-emerald-500",
  dormant: "bg-stone-400",
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Never"
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays > 1 && diffDays < 7) return `${diffDays}d ago`
    if (diffDays >= 7 && diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`

    const sameYear = d.getFullYear() === now.getFullYear()
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
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

export function getPriorityReason(person: Person): { label: string; icon: string } | null {
  const inbound = person.inboundInteractionCount ?? 0
  const outbound = person.outboundInteractionCount ?? 0
  const restacks = person.restackCount ?? 0
  const score = person.engagementScore ?? 0

  if (
    restacks > 0 &&
    (!person.lastOutboundAt || (person.lastInboundAt && person.lastOutboundAt < person.lastInboundAt))
  ) {
    return {
      label: `Restacked ${restacks > 1 ? `${restacks} notes` : "your note"} (no touch back)`,
      icon: "🔁",
    }
  }
  if (inbound >= 2 && outbound <= 1) {
    return {
      label: `Unreciprocated supporter (${inbound} received · ${outbound} given)`,
      icon: "❤️",
    }
  }
  if (score >= 12 && (person.driftStatus === "drifting" || person.driftStatus === "cold")) {
    return {
      label: `Top supporter drifting (${score} pts · inactive)`,
      icon: "✨",
    }
  }
  return null
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
  const lastOutboundLike = person.lastOutboundLikeAt
    ? new Date(person.lastOutboundLikeAt).getTime()
    : 0
  const lastAction = person.lastActionType
  const lastDir = person.lastActionDirection

  if (inbound === 0 && outbound === 0) {
    return null
  }

  // If you liked last (or liked after their comment), convo is ended/acknowledged
  const iLikedLast =
    (lastDir === "outbound" && lastAction === "like") ||
    (lastOutboundLike > 0 && lastInboundComment > 0 && lastOutboundLike > lastInboundComment)

  // 1. Comments and replies are triggers for "Needs your reply" and "Ball in their court"
  if (lastInboundComment > 0 && lastInboundComment > lastOutboundComment) {
    if (iLikedLast) {
      return {
        label: "You liked last",
        sublabel: "Convo acknowledged",
        variant: "stone",
        icon: "❤️",
      }
    }
    return {
      label: "Needs your reply",
      sublabel: "Commented last",
      variant: "amber",
      icon: "💬",
    }
  }

  if (lastOutboundComment > 0 && lastOutboundComment > lastInboundComment) {
    const isWithinWeek = Date.now() - lastOutboundComment <= 7 * 24 * 60 * 60 * 1000
    if (isWithinWeek) {
      return {
        label: "Ball in their court",
        sublabel: "You commented last",
        variant: "sky",
        icon: "📤",
      }
    }
    return {
      label: "No reply (7d+)",
      sublabel: "Engage on new note",
      variant: "stone",
      icon: "💬",
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

export function ReciprocityBadgePill({ reciprocity }: { reciprocity: ReciprocityInfo | null }) {
  if (!reciprocity) return null

  return (
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
        <span className="opacity-60 text-[9.5px] font-normal">• {reciprocity.sublabel}</span>
      </span>
    </div>
  )
}
