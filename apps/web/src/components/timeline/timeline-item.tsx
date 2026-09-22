import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
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
  if (targetType === "note") return "Note"
  if (targetType === "comment") return "comment"
  if (targetType === "post") return "post"
  return "Substack content"
}

export function interactionLabel(item: Interaction, personName: string) {
  const actor = item.direction === "inbound" ? personName : "You"
  if (item.actionType !== "like") return actor
  const possessive = item.direction === "inbound" ? "your" : `${personName}’s`
  return `${actor} liked ${possessive} ${targetLabel(item.targetType)}`
}

export function TimelineItem({
  item,
  personName,
}: {
  item: Interaction
  personName: string
}) {
  const badge = actionBadge(item.actionType, item.body)
  const Icon = badge.icon
  const isInbound = item.direction === "inbound"

  return (
    <div className="relative pb-2.5 last:pb-1">
      <span
        className={`absolute -left-5 top-0.5 flex size-4 items-center justify-center rounded border text-[9px] ${
          isInbound
            ? "border-emerald-300 bg-emerald-100 text-emerald-800"
            : "border-sky-300 bg-sky-100 text-sky-800"
        }`}
        title={isInbound ? "Inbound (from them)" : "Outbound (from you)"}
      >
        {isInbound ? (
          <ArrowDownLeft className="size-2.5" />
        ) : (
          <ArrowUpRight className="size-2.5" />
        )}
      </span>

      <div className="rounded border border-stone-200/80 bg-white/70 p-2.5 shadow-none transition-colors hover:bg-white dark:border-stone-800 dark:bg-stone-900/60">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold ${badge.color}`}
            >
              <Icon className="size-2.5" />
              {badge.label}
              <span className="opacity-75 font-normal">+{badge.pts}</span>
            </span>
            <span className="text-[10.5px] font-medium text-stone-500 truncate max-w-[220px]">
              {interactionLabel(item, personName)}
            </span>
          </div>
          <span className="text-[10.5px] text-muted-foreground shrink-0">
            {formatDate(item.occurredAt)}
          </span>
        </div>

        {item.body && (
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-stone-800 dark:text-stone-200 font-sans">
            {item.body}
          </p>
        )}

        {(item.targetTitle || item.targetBody || item.targetUrl || item.actionType === "like") && (
          <div className="mt-1.5 border-t border-stone-100 pt-1.5 text-[10.5px] text-muted-foreground dark:border-stone-800">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-stone-600 dark:text-stone-400">
                {item.targetTitle || (item.targetBody ? targetLabel(item.targetType) : "Target content unavailable")}
              </span>
              {item.targetUrl && (
                <a
                  href={item.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[#f15a3a] hover:underline"
                >
                  View <ExternalLink className="size-2.5" />
                </a>
              )}
            </div>
            {item.targetBody && (
              <blockquote className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap border-l-2 border-stone-200 pl-2 leading-relaxed text-stone-600 dark:border-stone-700 dark:text-stone-400">
                {item.targetBody}
              </blockquote>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
