import { grantedAppOrigin } from "../lib/app-origin"

import { circles } from "../lib/circles"

export { circles, CirclesError } from "../lib/circles"

export async function openInCircles(path = "/") {
  const origin = await grantedAppOrigin()
  if (origin) await chrome.tabs.create({ url: `${origin}${path}` })
}

export function message<T = Record<string, unknown>>(request: Record<string, unknown>): Promise<T & { ok: boolean; message?: string }> {
  return chrome.runtime.sendMessage(request).catch(() => ({
    ok: false,
    message: "The extension restarted. Close and reopen the panel.",
  }))
}

/** Subset of the web app's Person (apps/web/src/lib/types.ts) the panel shows. */
export interface Person {
  id: string
  name: string
  handle: string | null
  notes: string | null
  avatarUrl?: string | null
  isFollower?: boolean
  isSubscriber?: boolean
  inboundInteractionCount: number
  outboundInteractionCount: number
  lastInteractionAt: string | null
  lastActionType?: string | null
  lastActionDirection?: string | null
  tags?: Array<{ id: string; name: string }>
  lists?: Array<{ id: string; name: string }>
}

export interface Interaction {
  id: string
  direction: "inbound" | "outbound"
  actionType: string
  targetType: string | null
  occurredAt: string
}

export interface ListRecord {
  id: string
  name: string
  count: number
}

export interface Companion {
  user?: { id: string; email: string }
  connection: { publicationUrl: string | null; profile: { name: string | null; handle: string | null } } | null
  lists: Array<{ id: string; name: string }>
}

export interface ScheduledNote {
  id: string
  status: "pending" | "draft" | "scheduled" | "published" | "deleted"
  bodyText: string
  triggerAt: string | null
  publishedAt: string | null
  postNow: boolean
  tags: Array<{ id: string; name: string }>
}

export const queues = [
  { view: "needs-reply", label: "Needs your reply" },
  { view: "priority", label: "Priority to engage" },
  { view: "awaiting-response", label: "Ball in their court" },
] as const

export type QueueView = (typeof queues)[number]["view"]

export function findByHandle(handle: string) {
  return circles<{ people: Person[] }>(`/api/v1/people?search=${encodeURIComponent(handle)}&limit=20`)
    .then(({ people }) => people.find((person) => person.handle?.toLocaleLowerCase("en") === handle) ?? null)
}
