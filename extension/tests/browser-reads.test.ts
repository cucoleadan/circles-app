import { beforeEach, describe, expect, it, vi } from "bun:test";

let generation = 0;
const fresh = (): Promise<typeof import("../src/lib/browser-reads")> => import(`../src/lib/browser-reads?${generation}`);
let storage: Record<string, unknown>;
let calls: Array<{ url: string; body: any }>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const connection = { id: "connection-a", publicationUrl: "https://example-pub.substack.com/", profile: { id: 1, name: "Owner", handle: "owner" } };
const handleOptions = (handle: string) => json({ potentialHandles: [{ type: "suggested", handle: "other" }, { type: "existing", handle }] });

function mockFetch(route: (url: string, body: any) => Response) {
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return route(url, body);
  });
}

beforeEach(() => {
  generation += 1;
  calls = [];
  storage = { appOrigin: "https://circles.example" };
  (globalThis as any).chrome = {
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(storage[key]) })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, structuredClone(values)); }),
    } },
    permissions: { contains: vi.fn(async () => true) },
  };
});

describe("browser reads", () => {
  it("polls notifications from the server checkpoint and runs both audience sweeps", async () => {
    const syncedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    mockFetch((url, body) => {
      if (url.endsWith("/api/ext/companion")) return json({ ok: true, appState: { connection, activitySyncedAt: syncedAt, lists: [] } });
      if (url === "https://substack.com/api/v1/handle/options") return handleOptions("Owner");
      if (url.startsWith("https://substack.com/api/v1/activity-feed-web")) {
        return json({ activityItems: [{ id: "new", updated_at: new Date().toISOString() }], more: false });
      }
      if (url === "https://substack.com/api/v1/feed/following") return json([1, 2]);
      if (url === "https://example-pub.substack.com/api/v1/subscriber-stats") return json({ subscribers: [], count: 0 });
      if (url.endsWith("/api/ext/browser-reads") && body.kind === "subscribers") return json({ ok: true, completed: true });
      return json({ ok: true });
    });
    await (await fresh()).runBrowserReads();

    const circles = calls.filter((call) => call.url.startsWith("https://circles.example"));
    expect(circles.map((call) => call.url.replace("https://circles.example", "") + (call.body?.kind ? `:${call.body.kind}` : ""))).toEqual([
      "/api/ext/companion",
      "/api/ext/activity",
      "/api/ext/browser-reads:activity",
      "/api/ext/browser-reads:following",
      "/api/ext/browser-reads:subscribers",
    ]);
    expect(circles[1]!.body).toMatchObject({ expectedConnectionId: "connection-a", activityItems: [{ id: "new" }] });
    expect(circles[4]!.body).toMatchObject({ connectionId: "connection-a", offset: 0, payload: { count: 0 } });
    const state = storage.browserReadsV1 as { next: Record<string, number>; subscriberRun?: unknown };
    expect(state.subscriberRun).toBeUndefined();
    expect(state.next.subscribers! - Date.now()).toBeGreaterThan(19 * 3600_000);

    // Nothing is due a minute later, so nothing is read.
    calls = [];
    await (await fresh()).runBrowserReads();
    expect(calls).toEqual([]);
  });

  it("keeps a subscriber sweep's place and hands everything to the server when Substack challenges", async () => {
    storage.browserReadsV1 = { next: { activity: Date.now() + 600_000, following: Date.now() + 600_000 } };
    let pages = 0;
    mockFetch((url, body) => {
      if (url.endsWith("/api/ext/companion")) return json({ ok: true, appState: { connection, lists: [] } });
      if (url === "https://substack.com/api/v1/handle/options") return handleOptions("owner");
      if (url.endsWith("/subscriber-stats")) return ++pages === 1 ? json({ subscribers: [], count: 250 }) : json({}, 403);
      if (url.endsWith("/api/ext/browser-reads")) return json({ ok: true, completed: false, nextOffset: body.offset + 90 });
      return json({ ok: true });
    });
    await (await fresh()).runBrowserReads();

    const state = storage.browserReadsV1 as { pausedUntil: number; subscriberRun: { offset: number; connectionId: string } };
    expect(state.subscriberRun).toMatchObject({ connectionId: "connection-a", offset: 90 });
    expect(state.pausedUntil).toBeGreaterThan(Date.now() + 4 * 3600_000);
    expect(calls.filter((call) => call.url.endsWith("/subscriber-stats")).map((call) => call.body.offset)).toEqual([0, 90]);
  });

  it("reads nothing while Chrome is signed in to a different Substack account", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/ext/companion")) return json({ ok: true, appState: { connection, activitySyncedAt: new Date().toISOString(), lists: [] } });
      if (url === "https://substack.com/api/v1/handle/options") return handleOptions("someone-else");
      return json({ ok: true });
    });
    await (await fresh()).runBrowserReads();
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/ext/companion", "/api/v1/handle/options"]);
    expect((storage.browserReadsV1 as { pausedUntil: number }).pausedUntil).toBeGreaterThan(Date.now() + 50 * 60_000);
  });
});
