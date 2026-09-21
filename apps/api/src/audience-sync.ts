import type { SubscriberItem } from "./db/repositories.js"

type UnknownRecord = Record<string, unknown>

export interface SubscriberStatsPage {
  subscribers: SubscriberItem[]
  total: number
  skipped: number
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null

const optionalBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : false

function subscriptionTier(record: UnknownRecord) {
  const explicit = optionalString(record.subscription_type)
  if (explicit) return explicit
  if (optionalBoolean(record.is_founding)) return "founding"
  if (optionalBoolean(record.is_free_trial)) return "trial"
  if (optionalBoolean(record.is_gift)) return "gift"
  if (optionalBoolean(record.is_comp)) return "comp"
  return "free"
}

/**
 * Normalize the observed publication subscriber response without retaining
 * private fields such as email addresses or revenue data.
 *
 * Substack currently returns `subscribers` and `count`; `users` and `total`
 * are accepted as a compatibility fallback. A row's `is_subscribed` field is
 * not publication membership: free subscribers commonly have it set to false.
 * Presence in this publication-scoped collection is the membership evidence.
 */
export function parseSubscriberStatsPage(
  payload: unknown
): SubscriberStatsPage {
  if (!isRecord(payload))
    throw new Error("Substack returned an invalid subscriber response")

  const rawSubscribers = Array.isArray(payload.subscribers)
    ? payload.subscribers
    : Array.isArray(payload.users)
      ? payload.users
      : null
  if (!rawSubscribers) {
    throw new Error(
      "Substack subscriber response did not contain a subscriber list"
    )
  }

  const chartCounts = isRecord(payload.chartCounts) ? payload.chartCounts : null
  const rawTotal = payload.count ?? payload.total ?? chartCounts?.totalEmail
  const parsedTotal = typeof rawTotal === "number" ? rawTotal : Number(rawTotal)
  const total =
    Number.isFinite(parsedTotal) && parsedTotal >= 0
      ? Math.trunc(parsedTotal)
      : rawSubscribers.length

  const subscribers: SubscriberItem[] = []
  let skipped = 0
  for (const value of rawSubscribers) {
    if (!isRecord(value)) {
      skipped++
      continue
    }

    const rawId = value.user_id ?? value.id
    const id =
      typeof rawId === "number" || typeof rawId === "string"
        ? String(rawId).trim()
        : ""
    if (!id) {
      skipped++
      continue
    }

    subscribers.push({
      id,
      name: optionalString(value.user_name ?? value.name),
      photo_url: optionalString(value.user_photo_url ?? value.photo_url),
      handle: optionalString(value.user_handle ?? value.handle),
      subscription_type: subscriptionTier(value),
      subscription_created_at: optionalString(value.subscription_created_at),
    })
  }

  return { subscribers, total, skipped }
}

export function parseFollowerRunStartedAt(value: unknown, now = new Date()) {
  if (typeof value !== "string") return now
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime())
    return now
  return parsed
}

export function shouldAbortFollowerSweep(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  const status = candidate.status ?? candidate.statusCode
  if (status === 401 || status === 403 || status === 429) return true
  return /\b(401|403|429)\b/.test(String(candidate.message ?? ""))
}
