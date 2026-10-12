import {
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
        color:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
      }
    case "restack":
      if (body && body.trim().length > 0) {
        return {
          label: "Restack with note",
          pts: 3,
          icon: Repeat,
          color:
            "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300",
        }
      }
      return {
        label: "Restack",
        pts: 2,
        icon: Repeat,
        color:
          "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300",
      }
    case "comment":
      return {
        label: "Comment",
        pts: 3,
        icon: MessageCircle,
        color:
          "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
      }
    case "reply":
      return {
        label: "Reply",
        pts: 3,
        icon: MessageSquare,
        color:
          "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300",
      }
    default:
      return {
        label: action,
        pts: 1,
        icon: Sparkles,
        color:
          "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300",
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

/** Only links that open one post, Note, or comment; never the feed it was seen in. */
export function contentUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      /\/p\/[^/]+|\/(?:home|inbox)\/post\/p-?\d+|\/note\/c-\d+|\/comment\/\d+/.test(
        url.pathname
      )
      ? url.href
      : null
  } catch {
    return null
  }
}

/** The post title, or a snippet of the Note, that an interaction acted on. */
export function interactionTarget(
  item: Interaction
): { url: string; text: string } | null {
  const url = contentUrl(item.targetUrl)
  if (!url) return null
  const snippet = item.targetBody?.replace(/\s+/g, " ").trim()
  const { hostname, pathname } = new URL(url)
  return {
    url,
    text: item.targetTitle?.trim() || snippet || `${hostname}${pathname}`,
  }
}

function metaString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** Author, publication, and cover image for a post an interaction acted on. */
function postPreview(item: Interaction, personName: string) {
  const meta = item.metadata ?? {}
  const author = (meta.targetAuthor ?? {}) as Record<string, unknown>
  const image = metaString(meta.targetImage)
  return {
    image: image && /^https:\/\//.test(image) ? image : null,
    publication: metaString(meta.targetPublication),
    authorName: metaString(author.name) ?? personName,
    authorPhoto: metaString(author.photo_url) ?? metaString(author.photoUrl),
  }
}

function PostPreviewCard({
  item,
  personName,
  target,
}: {
  item: Interaction
  personName: string
  target: { url: string; text: string }
}) {
  const preview = postPreview(item, personName)
  const subtitle = item.targetBody?.replace(/\s+/g, " ").trim()
  return (
    <a
      href={target.url}
      target="_blank"
      rel="noreferrer"
      className="group/preview flex w-full max-w-md gap-3 rounded-xl border border-stone-200 bg-white p-2.5 text-left transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:bg-stone-900/70"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
          {preview.authorPhoto ? (
            <img
              src={preview.authorPhoto}
              alt=""
              loading="lazy"
              className="size-4 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <span className="truncate">
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {preview.authorName}
            </span>
            {preview.publication &&
              preview.publication !== preview.authorName && (
                <> · {preview.publication}</>
              )}
          </span>
        </span>
        <span className="line-clamp-2 text-[13px] leading-snug font-semibold text-stone-900 group-hover/preview:underline dark:text-stone-100">
          {item.targetTitle?.trim() || target.text}
        </span>
        {subtitle && (
          <span className="line-clamp-2 text-xs leading-snug text-stone-500 dark:text-stone-400">
            {subtitle}
          </span>
        )}
      </span>
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          className="size-16 shrink-0 self-center rounded-lg object-cover sm:h-[72px] sm:w-24"
        />
      )}
    </a>
  )
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
  showDivider = false,
}: {
  item: Interaction
  personName: string
  /** Draws the fading separator above this row. */
  showDivider?: boolean
}) {
  const isInbound = item.direction === "inbound"
  const ActionIcon = actionBadge(item.actionType, item.body).icon
  const actor = isInbound ? personName : "You"
  const label = interactionLabel(item, personName)
  const verb = actionWord(item.actionType)
  const remainder = label.slice(actor.length)
  const verbStart = remainder.indexOf(verb)
  const beforeVerb = verbStart >= 0 ? remainder.slice(0, verbStart) : remainder
  const afterVerb =
    verbStart >= 0 ? remainder.slice(verbStart + verb.length) : ""
  const target = interactionTarget(item)

  const time = (
    <time
      dateTime={item.occurredAt}
      title={new Date(item.occurredAt).toLocaleString()}
      className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums"
    >
      {formatDate(item.occurredAt)}
    </time>
  )

  // Conversation layout: their actions sit on the left with the time on the
  // right; yours sit on the right with the time on the left.
  return (
    <div>
      {showDivider && (
        <div
          aria-hidden="true"
          className="h-px bg-linear-to-r from-transparent via-stone-200 to-transparent dark:via-stone-700/80"
        />
      )}
      <div
        className="flex w-full items-center gap-2 rounded px-1.5 py-2.5 text-xs transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60"
        aria-label={`${label}, ${formatDate(item.occurredAt)}`}
      >
        {!isInbound && time}
        <span
          className={`flex min-w-0 flex-1 flex-col gap-0.5 ${isInbound ? "items-start" : "items-end"}`}
        >
          <span
            className="flex max-w-full min-w-0 items-center gap-1.5"
            title={label}
          >
            <ActionIcon
              className={`size-3 shrink-0 ${actionTextColor(item.actionType)}`}
              aria-hidden="true"
            />
            <span className="truncate text-stone-600 dark:text-stone-300">
              <strong
                className={`font-semibold ${
                  isInbound
                    ? "text-stone-900 dark:text-stone-100"
                    : "text-[#c2410c] dark:text-[#f8916f]"
                }`}
              >
                {actor}
              </strong>
              {beforeVerb}
              {verbStart >= 0 && (
                <strong
                  className={`font-semibold ${actionTextColor(item.actionType)}`}
                >
                  {verb}
                </strong>
              )}
              {afterVerb}
            </span>
          </span>
          {target && item.targetType === "post" ? (
            <span
              className={`flex w-full ${isInbound ? "justify-start pl-[18px]" : "justify-end"} pt-1`}
            >
              <PostPreviewCard
                item={item}
                personName={personName}
                target={target}
              />
            </span>
          ) : (
            target && (
              <a
                href={target.url}
                target="_blank"
                rel="noreferrer"
                title={target.url}
                className={`inline-flex max-w-full min-w-0 items-center gap-1 text-[11px] text-stone-500 hover:text-[#c2410c] hover:underline dark:text-stone-400 dark:hover:text-[#f8916f] ${
                  isInbound ? "pl-[18px]" : ""
                }`}
              >
                <span className="truncate">{target.text}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            )
          )}
        </span>
        {isInbound && time}
      </div>
    </div>
  )
}
