import { beforeEach, describe, expect, it, vi } from "bun:test";

if (!vi.stubGlobal) {
  vi.stubGlobal = (name: string, value: any) => {
    (globalThis as any)[name] = value;
  };
}
if (!vi.unstubAllGlobals) {
  vi.unstubAllGlobals = () => {};
}

// Bun has no vi.resetModules; a fresh query string re-evaluates the module, like a worker restart.
let generation = 0;
const freshQueue = (): Promise<typeof import("../src/lib/activity-queue")> => import(`../src/lib/activity-queue?${generation}`);
let storage: Record<string, unknown>;
beforeEach(() => {
  generation += 1;
  storage = {};
  vi.stubGlobal("chrome", { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(storage[key]) })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, structuredClone(values)); }),
  } } });
});
const app = { ok: true, appState: { connection: { id: "connection-a" } } };
const payload = { activityItems: [{ id: "first" }, { id: "middle" }, { id: "last" }] };
async function setup() {
  const queue = await freshQueue();
  await queue.rememberActivityConnection(app as never);
  return queue;
}
function pending() {
  return (storage.pendingActivityV1 as { batches: unknown[] }).batches.length;
}
describe("durable activity capture", () => {
  it("queues and delivers sanitized conversation batches using the same bridge", async () => {
    const queue = await setup();
    const { normalizeConversationResponse } = await import("../src/lib/conversation-capture");
    const conversation = normalizeConversationResponse("https://substack.com/api/v1/reader/comment/42/replies", { commentBranches: [{ comment: { id: 100, body: "Hello", handle: "ada", credential: "secret" }, descendantComments: [] }] })!;
    expect(await queue.enqueueActivity(conversation)).toMatchObject({ ok: true, queued: true });
    const bridge = vi.fn(async (request: { type: string }) => request.type === "GET_APP_STATE" ? app as never : { ok: true });
    await queue.drainActivity(bridge);
    expect(pending()).toBe(0);
    expect(bridge).toHaveBeenLastCalledWith({ type: "POST_ACTIVITY_BATCH", payload: { ...conversation, expectedConnectionId: "connection-a" } });
    expect(JSON.stringify(storage)).not.toContain("secret");
  });
  it("retains data when the app is closed and across worker restarts", async () => {
    let queue = await setup();
    expect(await queue.enqueueActivity(payload)).toMatchObject({ ok: true, queued: true });
    await queue.drainActivity(async () => ({ ok: false }));
    expect(pending()).toBe(1);
    generation += 1;
    queue = await freshQueue();
    await queue.drainActivity(async (request) => request.type === "GET_APP_STATE" ? app as never : { ok: true });
    expect(pending()).toBe(0);
  });
  it("deduplicates full payloads without losing changed middle items", async () => {
    const queue = await setup();
    await Promise.all([queue.enqueueActivity(payload), queue.enqueueActivity(payload)]);
    expect(pending()).toBe(1);
    await queue.enqueueActivity({ activityItems: [{ id: "first" }, { id: "changed" }, { id: "last" }] });
    expect(pending()).toBe(2);
  });
  it("retains failures, backs off, and removes only acknowledged deliveries", async () => {
    const queue = await setup();
    await queue.enqueueActivity(payload);
    const bridge = vi.fn(async (request: { type: string }) => request.type === "GET_APP_STATE" ? app as never : { ok: false });
    await queue.drainActivity(bridge);
    expect(pending()).toBe(1);
    expect((storage.pendingActivityV1 as { batches: { retryAt: number }[] }).batches[0]!.retryAt).toBeGreaterThan(Date.now());
    bridge.mockClear();
    await queue.drainActivity(bridge);
    expect(bridge).not.toHaveBeenCalled();
  });
  it("does not send batches to another connection", async () => {
    const queue = await setup();
    await queue.enqueueActivity(payload);
    const bridge = vi.fn(async () => ({ ok: true, appState: { connection: { id: "connection-b" } } } as never));
    await queue.drainActivity(bridge);
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(1);
  });
  it("preserves existing batches when the queue fills", async () => {
    const queue = await setup();
    for (let id = 0; id < 100; id++) await queue.enqueueActivity({ activityItems: [{ id }] });
    expect(await queue.enqueueActivity({ activityItems: [{ id: 101 }] })).toMatchObject({ ok: false });
    expect(pending()).toBe(100);
  });
  it("does not queue data without a known connection", async () => {
    const queue = await freshQueue();
    expect(await queue.enqueueActivity(payload)).toMatchObject({ ok: false });
  });
});
