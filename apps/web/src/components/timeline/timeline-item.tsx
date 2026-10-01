import {
  Heart,
  MessageCircle,
  MessageSquare,
  Repeat,
  Sparkles,
} from "lucide-react"
import type { Interaction } from "../../lib/types"

export function actionBadge(action: string, body?: string | null) {
  switch (action) {
    case "like":
      return {
        label: "Like",
        pts: 1,
        icon: Heart,
        color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
      }
    case "restack":
      if (body && body.trim().length > 0) {
        return {
          label: "Restack with note",
          pts: 3,
          icon: Repeat,
          color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300",
        }
      }
      return {
        label: "Restack",
        pts: 2,
        icon: Repeat,
        color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300",
      }
    case "comment":
      return {
        label: "Comment",
        pts: 3,
        icon: MessageCircle,
        color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
      }
    case "reply":
      return {
        label: "Reply",
        pts: 3,
        icon: MessageSquare,
        color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300",
      }
    default:
      return {
        label: action,
        pts: 1,
        icon: Sparkles,
        color: "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300",
      }
  }
}

export function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60)
    if (diffHours < 24 && diffHours >= 0) {
      if (diffHours < 1) return "Just now"
      return `${Math.floor(diffHours)}h ago`
    }
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    })
  } catch {
    return iso
  }
}

export function targetLabel(targetType: string | null) {
  if (targetType === "note") return "note"
  if (targetType === "comment") return "comment"
  if (targetType === "post") return "post"
  return "content"
}

export function interactionLabel(item: Interaction, personName: string) {
  const target = targetLabel(item.targetType)

  if (item.direction === "inbound") {
    switch (item.actionType) {
      case "like":
        return `${personName} liked your ${target}`
      case "restack":
        return `${personName} restacked your ${target}`
      case "comment":
        return `${personName} commented on your ${target}`
      case "reply":
        return `${personName} replied to you`
      case "subscribe":
        return `${personName} subscribed to you`
      case "mention":
        return `${personName} mentioned you`
      default:
        return `${personName} interacted with you`
    }
  }

  switch (item.actionType) {
    case "like":
      return `You liked ${personName}’s ${target}`
    case "restack":
      return `You restacked ${personName}’s ${target}`
    case "comment":
      return `You commented on ${personName}’s ${target}`
    case "reply":
      return `You replied to ${personName}`
    case "subscribe":
      return `You subscribed to ${personName}`
    case "mention":
      return `You mentioned ${personName}`
    default:
      return `You interacted with ${personName}`
  }
}

function actionWord(actionType: string) {
  switch (actionType) {
    case "like":
      return "liked"
    case "restack":
      return "restacked"
    case "comment":
      return "commented"
    case "reply":
      return "replied"
    case "subscribe":
      return "subscribed"
    case "mention":
      return "mentioned"
    default:
      return "interacted"
  }
}

function actionTextColor(actionType: string) {
  switch (actionType) {
    case "like":
      return "text-rose-600 dark:text-rose-400"
    case "restack":
      return "text-violet-600 dark:text-violet-400"
    case "comment":
      return "text-emerald-600 dark:text-emerald-400"
    case "reply":
      return "text-sky-600 dark:text-sky-400"
    default:
      return "text-stone-600 dark:text-stone-300"
  }
}

export function TimelineItem({
  item,
  personName,
}: {
  item: Interaction
  personName: string
}) {
  const isInbound = item.direction === "inbound"
  const ActionIcon = actionBadge(item.actionType, item.body).icon
  const actor = isInbound ? personName : "You"
  const label = interactionLabel(item, personName)
  const verb = actionWord(item.actionType)
  const remainder = label.slice(actor.length)
  const verbStart = remainder.indexOf(verb)
  const beforeVerb = verbStart >= 0 ? remainder.slice(0, verbStart) : remainder
  const afterVerb = verbStart >= 0 ? remainder.slice(verbStart + verb.length) : ""

  const time = (
    <time
      dateTime={item.occurredAt}
      title={new Date(item.occurredAt).toLocaleString()}
      className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground"
    >
      {formatDate(item.occurredAt)}
    </time>
  )

  // Conversation layout: their actions sit on the left with the time on the
  // right; yours sit on the right with the time on the left.
  return (
    <div className={`flex pb-2 last:pb-1 ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`flex w-[88%] items-center gap-2 rounded border px-2.5 py-2 text-xs transition-colors ${
          isInbound
            ? "border-stone-200/80 bg-white/70 hover:bg-white dark:border-stone-800 dark:bg-stone-900/60"
            : "border-[#f15a3a]/25 bg-[#f15a3a]/[0.04] hover:bg-[#f15a3a]/[0.07] dark:border-[#f15a3a]/30 dark:bg-[#f15a3a]/10"
        }`}
        aria-label={`${label}, ${formatDate(item.occurredAt)}`}
      >
        {!isInbound && time}
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 ${isInbound ? "" : "justify-end"}`}
          title={label}
        >
          <ActionIcon className={`size-3 shrink-0 ${actionTextColor(item.actionType)}`} aria-hidden="true" />
          <span className="truncate text-stone-600 dark:text-stone-300">
            <strong className="font-semibold text-stone-900 dark:text-stone-100">{actor}</strong>
            {beforeVerb}
            {verbStart >= 0 && (
              <strong className={`font-semibold ${actionTextColor(item.actionType)}`}>{verb}</strong>
            )}
            {afterVerb}
          </span>
        </span>
        {isInbound && time}
      </div>
    </div>
  )
}
