import { beforeEach, describe, expect, it, vi } from "bun:test";
import { getAppOrigin, isAppOriginUrl, normalizeAppOrigin, originFromPattern, setAppOrigin } from "../src/lib/app-origin";

let storage: Record<string, unknown>;
let granted: boolean;
const register = vi.fn(async () => undefined);
const update = vi.fn(async () => undefined);
const unregister = vi.fn(async () => undefined);
let registered: unknown[];

beforeEach(() => {
  storage = {};
  granted = true;
  registered = [];
  register.mockClear();
  update.mockClear();
  unregister.mockClear();
  (globalThis as any).chrome = {
    storage: { local: {
      get: async (key: string) => ({ [key]: storage[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(storage, values); },
    } },
    permissions: { contains: async () => granted },
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: register,
      updateContentScripts: update,
      unregisterContentScripts: unregister,
    },
  };
});

describe("Circles server pairing", () => {
  it("accepts https servers and local http, and nothing else", () => {
    expect(normalizeAppOrigin("circles.example.com/app")).toBe("https://circles.example.com");
    expect(normalizeAppOrigin(" https://circles.example.com:8443/x ")).toBe("https://circles.example.com:8443");
    expect(normalizeAppOrigin("http://localhost:4321")).toBe("http://localhost:4321");
    expect(normalizeAppOrigin("http://circles.example.com")).toBeNull();
    expect(normalizeAppOrigin("https://user:pass@circles.example.com")).toBeNull();
    expect(normalizeAppOrigin("javascript:alert(1)")).toBeNull();
  });

  it("derives a paired origin only from exact host grants", () => {
    expect(originFromPattern("https://circles.example.com/*")).toBe("https://circles.example.com");
    expect(originFromPattern("https://*.substack.com/*")).toBeNull();
    expect(originFromPattern("https://*/*")).toBeNull();
  });

  it("is unpaired until a valid server is stored", async () => {
    expect(await getAppOrigin()).toBeNull();
    expect(await isAppOriginUrl("http://localhost:4321/")).toBe(false);
    storage.appOrigin = "http://evil.example.com";
    expect(await getAppOrigin()).toBeNull();
    storage.appOrigin = "https://circles.example.com";
    expect(await getAppOrigin()).toBe("https://circles.example.com");
    expect(await isAppOriginUrl("https://circles.example.com/settings")).toBe(true);
    expect(await isAppOriginUrl("https://circles.example.com.evil.test/")).toBe(false);
  });

  it("registers the app bridge for the paired server, or removes it without access", async () => {
    expect(await setAppOrigin("https://circles.example.com")).toBe(true);
    expect(register).toHaveBeenCalledWith([expect.objectContaining({ matches: ["https://circles.example.com/*"], js: ["content.js"] })]);

    registered = [{ id: "circles-app-bridge" }];
    expect(await setAppOrigin("https://other.example.com")).toBe(true);
    expect(update).toHaveBeenCalledWith([expect.objectContaining({ matches: ["https://other.example.com/*"] })]);

    granted = false;
    expect(await setAppOrigin("https://third.example.com")).toBe(false);
    expect(unregister).toHaveBeenCalled();
  });
});
