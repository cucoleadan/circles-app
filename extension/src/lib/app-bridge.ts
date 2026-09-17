import { APP_ORIGIN, APP_ORIGINS } from "./constants";
import type { BridgeRequest, BridgeResponse } from "./types";

export function isAppOriginUrl(url: string | undefined): boolean {
  try { return !!url && APP_ORIGINS.some((origin) => new URL(url).origin === origin); }
  catch { return false; }
}

async function send(tabId: number, request: BridgeRequest, timeout = 20_000): Promise<BridgeResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      chrome.tabs.sendMessage(tabId, request),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Bridge timeout")), timeout); }),
    ]);
    if (!response || typeof (response as BridgeResponse).ok !== "boolean") throw new Error("Invalid bridge response");
    return response as BridgeResponse;
  } finally { clearTimeout(timer); }
}

export async function requestViaBridge(request: BridgeRequest, open = false): Promise<BridgeResponse> {
  try {
    let tabs = (await chrome.tabs.query({ url: APP_ORIGINS.map((origin) => `${origin}/*`) }))
      .filter((tab) => tab.id !== undefined && isAppOriginUrl(tab.url))
      .sort((a, b) => Number(b.active) - Number(a.active));
    // Do not silently mix production and localhost accounts.
    const origin = tabs[0]?.url ? new URL(tabs[0].url).origin : APP_ORIGIN;
    tabs = tabs.filter((tab) => new URL(tab.url!).origin === origin);
    if (!tabs.length && open) tabs = [await chrome.tabs.create({ url: `${APP_ORIGIN}/app/companion`, active: true })];
    if (!tabs.length) return { ok: false, message: "Open the StackedHQ app in a tab first." };
    const deadline = Date.now() + 5_000;
    do {
      for (const tab of tabs) {
        let ready = false;
        try { ready = (await send(tab.id!, { type: "BRIDGE_PING" }, 750)).ok; } catch { /* Try another ready tab. */ }
        if (ready) {
          // Send mutations only once. An uncertain response must not trigger replay or tab reload.
          try { return await send(tab.id!, request); }
          catch { return { ok: false, message: "StackedHQ did not confirm the request. Check the app before retrying." }; }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return { ok: false, message: "Reload the StackedHQ tab once to activate the updated extension." };
  } catch { return { ok: false, message: "Could not reach the StackedHQ app tab." }; }
}

export const requestConnectBridge = (request: BridgeRequest) => requestViaBridge(request, true);
