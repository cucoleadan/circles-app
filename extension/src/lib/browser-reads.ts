import { activityBackfillUrl, planActivityBackfillPage } from "./activity-pagination";
import { circles, CirclesError } from "./circles";
import type { AppState, ConnectionSummary } from "./types";

// While Chrome is open the extension reads Substack with the user's own
// session, so the server reads less. The server stays the fallback: it skips
// its notifications poll while a browser poll is under 15 minutes old and its
// audience sweeps while a browser sweep is under 48 hours old (migration 038).

const KEY = "browserReadsV1";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CADENCE = { activity: 10 * MINUTE, following: 24 * HOUR, subscribers: 24 * HOUR };
const SUBSCRIBER_PAGE_SIZE = 100;
const SUBSCRIBER_PAGES_PER_TICK = 50;
type Read = keyof typeof CADENCE;
type Run = { connectionId: string; runStartedAt: string; offset: number };
export type BrowserReadsState = { next: Partial<Record<Read, number>>; pausedUntil?: number; subscriberRun?: Run };

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

/** Chrome may be signed in to another Substack account; only read for the connected one. */
async function sameAccount(connection: ConnectionSummary): Promise<boolean> {
  const expected = connection.profile.handle?.toLowerCase();
  if (!expected) return false;
  const options = await substack("https://substack.com/api/v1/handle/options") as { potentialHandles?: Array<{ type?: string; handle?: string }> } | null;
  return options?.potentialHandles?.find((option) => option.type === "existing")?.handle?.toLowerCase() === expected;
}

const report = (body: Record<string, unknown>) =>
  circles<{ ok: boolean; completed?: boolean; nextOffset?: number }>("/api/ext/browser-reads", { method: "POST", body });

/** Notifications newest-first back to the server's checkpoint minus 30 minutes, like the worker's poll. */
async function pollActivity(connection: ConnectionSummary, syncedAt: string | null | undefined): Promise<boolean> {
  // The first sync stays on the server, which also sets the checkpoint.
  const last = syncedAt ? Date.parse(syncedAt) : Number.NaN;
  if (!Number.isFinite(last)) return true;
  const cutoff = new Date(last - 30 * MINUTE).toISOString();
  const maxPages = Date.now() - last > HOUR ? 20 : 5;
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const plan = planActivityBackfillPage(await substack(activityBackfillUrl(after)), after, cutoff);
    if (plan.count) await circles("/api/ext/activity", { method: "POST", body: { ...plan.payload, expectedConnectionId: connection.id } });
    if (plan.reason !== "continue") {
      await report({ kind: "activity", connectionId: connection.id });
      return true;
    }
    after = plan.nextAfter;
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
  if (run?.connectionId !== connection.id || Date.now() - Date.parse(run.runStartedAt) > 5 * HOUR) {
    run = { connectionId: connection.id, runStartedAt: new Date().toISOString(), offset: 0 };
  }
  for (let page = 0; page < SUBSCRIBER_PAGES_PER_TICK; page++) {
    if (page) await sleep(2_000);
    const payload = await substack(`${origin.origin}/api/v1/subscriber-stats`, {
      limit: SUBSCRIBER_PAGE_SIZE,
      offset: run.offset,
      filters: { order_by: "subscription_created_at" },
    });
    const result = await report({ kind: "subscribers", connectionId: connection.id, runStartedAt: run.runStartedAt, offset: run.offset, payload });
    if (result.completed) {
      delete state.subscriberRun;
      return true;
    }
    if (typeof result.nextOffset !== "number" || result.nextOffset <= run.offset) throw new Error("Subscriber sweep did not advance.");
    run = { ...run, offset: result.nextOffset };
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
  try {
    if (!await sameAccount(connection)) {
      state.pausedUntil = Date.now() + HOUR;
      await save();
      console.warn("[Circles] Chrome is signed in to a different Substack account; the server keeps reading.");
      return;
    }
  } catch (error) {
    state.pausedUntil = Date.now() + (error instanceof SubstackError && (error.status === 401 || error.status === 403) ? jittered(6 * HOUR) : CADENCE.activity);
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
      if (error instanceof SubstackError && (error.status === 401 || error.status === 403)) state.pausedUntil = Date.now() + jittered(6 * HOUR);
      // A sweep the server refused (out of order or a replaced connection) starts again.
      if (error instanceof CirclesError && error.status === 409) delete state.subscriberRun;
      console.warn(`[Circles] Browser ${kind} read stopped; the server will cover it.`, error instanceof Error ? error.message : error);
    }
    await save();
    if ((state.pausedUntil ?? 0) > Date.now()) return;
  }
}

let running: Promise<void> | null = null;

/** Runs whichever browser reads are due; overlapping calls share one run. */
export function runBrowserReads(): Promise<void> {
  running ??= tick().finally(() => {
    running = null;
  });
  return running;
}
