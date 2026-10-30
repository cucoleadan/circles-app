import { activityBackfillUrl } from "./activity-pagination";
import { circles, CirclesError } from "./circles";
import type { AppState, ConnectionSummary } from "./types";

// While Chrome is open the extension reads Substack with the user's own
// session, so the server reads less. The server stays the fallback: it skips
// its notifications poll while a browser poll is under 15 minutes old and its
// audience sweeps while a browser sweep is under 48 hours old (migration 038).

export const BROWSER_READS_KEY = "browserReadsV1";
const KEY = BROWSER_READS_KEY;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CADENCE = { activity: 10 * MINUTE, following: 24 * HOUR, subscribers: 24 * HOUR };
const SUBSCRIBER_PAGE_SIZE = 100;
const SUBSCRIBER_PAGES_PER_TICK = 50;
type Read = keyof typeof CADENCE;
/** runStartedAt is the server's, so a skewed browser clock cannot affect the reconcile. */
type Run = { connectionId: string; runStartedAt: string; offset: number };
/** Why browser reads stopped, shown in the side panel until a check passes. */
export type BrowserReadsIssue =
  | { kind: "account"; browserHandle: string; connectedHandle: string | null }
  | { kind: "signed-out" }
  | { kind: "challenged" };
export type BrowserReadsState = {
  next: Partial<Record<Read, number>>;
  pausedUntil?: number;
  subscriberRun?: Run;
  issue?: BrowserReadsIssue;
};

/** ±20%, like the worker, so reads never land on an exact clock. */
const jittered = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SubstackError extends Error {
  constructor(readonly status: number) {
    super(`Substack returned ${status}.`);
  }
}

async function substack(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: { accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new SubstackError(response.status);
  return response.json();
}

/** The handle Chrome's Substack session belongs to, or null when signed out. */
async function browserHandle(): Promise<string | null> {
  const options = await substack("https://substack.com/api/v1/handle/options") as { potentialHandles?: Array<{ type?: string; handle?: string }> } | null;
  return options?.potentialHandles?.find((option) => option.type === "existing")?.handle ?? null;
}

const stoppedBy = (error: unknown): BrowserReadsIssue | null =>
  error instanceof SubstackError && error.status === 401 ? { kind: "signed-out" }
    : error instanceof SubstackError && error.status === 403 ? { kind: "challenged" }
    : null;

const report = (body: Record<string, unknown>) =>
  circles<{ ok: boolean; completed?: boolean; nextOffset?: number; runStartedAt?: string }>("/api/ext/browser-reads", { method: "POST", body });

/** Newest of updated_at and created_at: grouped notifications gain senders after creation. */
function itemTime(item: unknown): number {
  const record = (item && typeof item === "object" ? item : {}) as { updated_at?: unknown; created_at?: unknown };
  const updated = typeof record.updated_at === "string" ? Date.parse(record.updated_at) : Number.NaN;
  const created = typeof record.created_at === "string" ? Date.parse(record.created_at) : Number.NaN;
  if (!Number.isFinite(updated)) throw new Error("Activity item has no valid updated_at.");
  return Number.isFinite(created) ? Math.max(updated, created) : updated;
}

/**
 * Notifications newest-first back to the server's checkpoint minus 30 minutes,
 * read like the worker's SDK poll: whole pages (the feed is not strictly sorted
 * and ingestion is idempotent), next cursor = last item's updated_at minus 1 ms.
 */
async function pollActivity(connection: ConnectionSummary, syncedAt: string | null | undefined): Promise<boolean> {
  // The first sync stays on the server, which also sets the checkpoint.
  const last = syncedAt ? Date.parse(syncedAt) : Number.NaN;
  if (!Number.isFinite(last)) return true;
  const checkpoint = last - 30 * MINUTE;
  const maxPages = Date.now() - last > HOUR ? 20 : 5;
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    if (page) await sleep(2_000);
    const payload = await substack(activityBackfillUrl(after)) as { activityItems?: unknown; more?: unknown } | null;
    const items = payload?.activityItems;
    if (!Array.isArray(items) || typeof payload?.more !== "boolean") throw new Error("Invalid activity page.");
    if (items.length) await circles("/api/ext/activity", { method: "POST", body: { ...payload, expectedConnectionId: connection.id } });
    const times = items.map(itemTime);
    if (!payload.more || !items.length || Math.min(...times) < checkpoint) {
      await report({ kind: "activity", connectionId: connection.id });
      return true;
    }
    const next = Date.parse((items.at(-1) as { updated_at: string }).updated_at) - 1;
    if (after !== null && next >= Date.parse(after)) throw new Error("Activity cursor did not advance.");
    after = new Date(next).toISOString();
  }
  // Too far behind for one poll: the checkpoint stays put and the server catches up.
  return true;
}

async function sweepFollowing(connection: ConnectionSummary): Promise<boolean> {
  await report({ kind: "following", connectionId: connection.id, payload: await substack("https://substack.com/api/v1/feed/following") });
  return true;
}

/** Subscriber pages in order; the server reconciles unsubscribes only after the last one. */
async function sweepSubscribers(connection: ConnectionSummary, state: BrowserReadsState, save: () => Promise<void>): Promise<boolean> {
  let origin: URL;
  try { origin = new URL(connection.publicationUrl ?? ""); } catch { return true; }
  // Host access covers only *.substack.com; a custom domain stays on the server sweep.
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".substack.com")) return true;
  let run = state.subscriberRun;
  // The server accepts a run for 6 hours; start over well before that.
  if (run?.connectionId !== connection.id || Date.now() - Date.parse(run.runStartedAt) > 5 * HOUR) run = undefined;
  for (let page = 0; page < SUBSCRIBER_PAGES_PER_TICK; page++) {
    if (page) await sleep(2_000);
    const offset = run?.offset ?? 0;
    const payload = await substack(`${origin.origin}/api/v1/subscriber-stats`, {
      limit: SUBSCRIBER_PAGE_SIZE,
      offset,
      filters: { order_by: "subscription_created_at" },
    });
    // The first page starts a run; the server stamps its start time.
    const result = await report({ kind: "subscribers", connectionId: connection.id, runStartedAt: run?.runStartedAt, offset, payload });
    if (result.completed) {
      delete state.subscriberRun;
      return true;
    }
    if (typeof result.nextOffset !== "number" || result.nextOffset <= offset || typeof result.runStartedAt !== "string") {
      throw new Error("Subscriber sweep did not advance.");
    }
    run = { connectionId: connection.id, runStartedAt: result.runStartedAt, offset: result.nextOffset };
    state.subscriberRun = run;
    await save();
  }
  return false;
}

async function read(): Promise<BrowserReadsState> {
  return ((await chrome.storage.local.get(KEY))[KEY] as BrowserReadsState | undefined) ?? { next: {} };
}

async function tick(): Promise<void> {
  const state = await read();
  const save = () => chrome.storage.local.set({ [KEY]: state });
  const due = (kind: Read) => (state.next[kind] ?? 0) <= Date.now();
  if ((state.pausedUntil ?? 0) > Date.now() || !(Object.keys(CADENCE) as Read[]).some(due)) return;

  let app: AppState | undefined;
  try {
    app = (await circles<{ ok: boolean; appState?: AppState }>("/api/ext/companion")).appState;
  } catch {
    return; // Unpaired, logged out or unreachable: the server keeps reading.
  }
  const connection = app?.connection;
  if (!connection) return;
  // Chrome may be signed in to another Substack account; only read for the connected one.
  try {
    const handle = await browserHandle();
    const connected = connection.profile.handle;
    if (!handle || handle.toLowerCase() !== connected?.toLowerCase()) {
      state.issue = handle ? { kind: "account", browserHandle: handle, connectedHandle: connected } : { kind: "signed-out" };
      state.pausedUntil = Date.now() + HOUR;
      await save();
      console.warn("[Circles] Chrome's Substack account does not match the connected one; the server keeps reading.");
      return;
    }
    delete state.issue;
  } catch (error) {
    const issue = stoppedBy(error);
    if (issue) state.issue = issue;
    state.pausedUntil = Date.now() + (issue ? jittered(6 * HOUR) : CADENCE.activity);
    await save();
    return;
  }

  for (const kind of Object.keys(CADENCE) as Read[]) {
    if (!due(kind)) continue;
    // Book the retry first, so a failed read waits instead of repeating every minute.
    state.next[kind] = Date.now() + CADENCE.activity;
    await save();
    try {
      const finished = kind === "activity" ? await pollActivity(connection, app?.activitySyncedAt)
        : kind === "following" ? await sweepFollowing(connection)
        : await sweepSubscribers(connection, state, save);
      state.next[kind] = Date.now() + (finished ? jittered(CADENCE[kind]) : 0);
    } catch (error) {
      // Signed out or challenged by Cloudflare: hand every read back to the server for a while.
      const issue = stoppedBy(error);
      if (issue) {
        state.issue = issue;
        state.pausedUntil = Date.now() + jittered(6 * HOUR);
      }
      // A sweep the server refused (out of order or a replaced connection) starts again.
      if (error instanceof CirclesError && error.status === 409) delete state.subscriberRun;
      console.warn(`[Circles] Browser ${kind} read stopped; the server will cover it.`, error instanceof Error ? error.message : error);
    }
    await save();
    if ((state.pausedUntil ?? 0) > Date.now()) return;
  }
}

/** Drops a pause so the next alarm checks again, e.g. after switching Substack accounts. */
export async function retryBrowserReads(): Promise<void> {
  const state = await read();
  delete state.pausedUntil;
  delete state.issue;
  await chrome.storage.local.set({ [KEY]: state });
}

let running: Promise<void> | null = null;

/** Runs whichever browser reads are due; overlapping calls share one run. */
export function runBrowserReads(): Promise<void> {
  running ??= tick().finally(() => {
    running = null;
  });
  return running;
}
