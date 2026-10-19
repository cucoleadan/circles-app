import { afterEach, beforeEach, describe, expect, it, jest, vi } from "bun:test";
import { requestViaBridge } from "../src/lib/app-bridge";

if (!vi.stubGlobal) {
  vi.stubGlobal = (name: string, value: any) => {
    (globalThis as any)[name] = value;
  };
}
if (!vi.unstubAllGlobals) {
  vi.unstubAllGlobals = () => {};
}

// Bun has only the sync timer API; step it and let pending promises settle in between.
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    vi.advanceTimersByTime(10);
    jest.setSystemTime(new Date(Date.now() + 10));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }
}
const url = "http://localhost:4321/app/settings";
const query = vi.fn();
const sendMessage = vi.fn();
const create = vi.fn();
const contains = vi.fn();
beforeEach(() => {
  contains.mockReset().mockResolvedValue(true);
  vi.useFakeTimers();
  query.mockReset().mockResolvedValue([{ id: 1, url, active: true }]);
  sendMessage.mockReset().mockResolvedValue({ ok: true });
  create.mockReset().mockResolvedValue({ id: 2, url });
  vi.stubGlobal("chrome", {
    tabs: { query, sendMessage, create },
    permissions: { contains },
    storage: { local: { get: async () => ({ appOrigin: "http://localhost:4321" }) } },
  });
});
afterEach(() => { vi.useRealTimers(); jest.setSystemTime(); vi.unstubAllGlobals(); });

describe("app bridge", () => {
  it("asks to pair a server before using one Chrome has not granted", async () => {
    contains.mockResolvedValue(false);
    expect(await requestViaBridge({ type: "GET_APP_STATE" }, true)).toMatchObject({ ok: false, message: expect.stringContaining("Circles server") });
    expect(query).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("does not open a tab for passive requests", async () => {
    query.mockResolvedValue([]);
    expect(await requestViaBridge({ type: "GET_APP_STATE" })).toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });
  it("tries another ready app tab before sending a mutation", async () => {
    query.mockResolvedValue([{ id: 1, url }, { id: 2, url }]);
    sendMessage.mockImplementation(async (id, request) => {
      if (id === 1) throw new Error("No receiver");
      return { ok: true };
    });
    expect(await requestViaBridge({ type: "POST_INSTALL" })).toEqual({ ok: true });
    expect(sendMessage.mock.calls.filter(([, request]) => request.type === "POST_INSTALL")).toHaveLength(1);
    expect(sendMessage).toHaveBeenLastCalledWith(2, { type: "POST_INSTALL" });
  });
  it("waits for readiness without reloading the app", async () => {
    sendMessage.mockRejectedValueOnce(new Error("Not ready"));
    const result = requestViaBridge({ type: "GET_APP_STATE" });
    await advance(300);
    expect(await result).toEqual({ ok: true });
  });
  it("does not replay a mutation after an uncertain response", async () => {
    sendMessage.mockImplementation(async (_id, request) => {
      if (request.type === "BRIDGE_PING") return { ok: true };
      throw new Error("Port closed after request sent");
    });
    expect(await requestViaBridge({ type: "POST_INSTALL" })).toMatchObject({ ok: false });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it("times out a hung response without replaying it", async () => {
    sendMessage.mockImplementation((_id, request) => request.type === "BRIDGE_PING" ? Promise.resolve({ ok: true }) : new Promise(() => {}));
    const result = requestViaBridge({ type: "POST_INSTALL" });
    await advance(20_100);
    expect(await result).toMatchObject({ ok: false });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it("only talks to tabs on the paired server", async () => {
    query.mockResolvedValue([{ id: 1, url: "http://localhost:4321/app", active: true }, { id: 2, url: "http://127.0.0.1:4321/app" }]);
    sendMessage.mockRejectedValue(new Error("No receiver"));
    const result = requestViaBridge({ type: "GET_APP_STATE" });
    await advance(5_100);
    expect(await result).toMatchObject({ ok: false });
    expect(sendMessage.mock.calls.every(([id]) => id === 1)).toBe(true);
  });
});
