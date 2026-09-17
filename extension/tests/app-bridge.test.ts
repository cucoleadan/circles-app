import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAppOriginUrl, requestViaBridge } from "../src/lib/app-bridge";

if (!vi.stubGlobal) {
  vi.stubGlobal = (name: string, value: any) => {
    (globalThis as any)[name] = value;
  };
}
if (!vi.unstubAllGlobals) {
  vi.unstubAllGlobals = () => {};
}

const url = "https://circles.mhntwrkdan.dev/app/settings";
const query = vi.fn();
const sendMessage = vi.fn();
const create = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  query.mockReset().mockResolvedValue([{ id: 1, url, active: true }]);
  sendMessage.mockReset().mockResolvedValue({ ok: true });
  create.mockReset().mockResolvedValue({ id: 2, url });
  vi.stubGlobal("chrome", { tabs: { query, sendMessage, create } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("app bridge", () => {
  it("checks exact origins rather than URL prefixes", () => {
    expect(isAppOriginUrl(url)).toBe(true);
    expect(isAppOriginUrl("https://circles.mhntwrkdan.dev.evil.test/app")).toBe(false);
    expect(isAppOriginUrl("http://localhost:51730/app")).toBe(false);
    expect(isAppOriginUrl("invalid")).toBe(false);
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
    await vi.advanceTimersByTimeAsync(300);
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
    await vi.advanceTimersByTimeAsync(20_100);
    expect(await result).toMatchObject({ ok: false });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it("does not fall back from localhost into a production account", async () => {
    query.mockResolvedValue([{ id: 1, url: "http://localhost:5173/app", active: true }, { id: 2, url }]);
    sendMessage.mockRejectedValue(new Error("No receiver"));
    const result = requestViaBridge({ type: "GET_APP_STATE" });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(await result).toMatchObject({ ok: false });
    expect(sendMessage.mock.calls.every(([id]) => id === 1)).toBe(true);
  });
});
