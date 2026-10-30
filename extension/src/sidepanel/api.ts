import { grantedAppOrigin } from "../lib/app-origin"

// The panel calls the paired Circles server directly. The extension holds host
// permission for that origin, so Chrome sends its login cookie; the header
// passes the API's write-origin check (apps/api/src/index.ts).

export class CirclesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function circles<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const origin = await grantedAppOrigin()
  if (!origin) throw new CirclesError("Pair your Circles server first.", 0)
  let response: Response
  try {
    response = await fetch(`${origin}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: {
        "X-Circles-Extension": "v1",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new CirclesError("Could not reach Circles.", 0)
  }
  if (response.status === 401 || (response.redirected && response.url.includes("/login"))) {
    throw new CirclesError("Log in to Circles first.", 401)
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new CirclesError(data?.error ?? data?.message ?? `Circles returned ${response.status}.`, response.status)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

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
