import { APP_ORIGIN, APP_ORIGINS } from "./constants";
import type { BridgeRequest, BridgeResponse } from "./types";

export function isAppOriginUrl(url: string | undefined): boolean {
  try {
    return !!url && APP_ORIGINS.some((origin) => new URL(url).origin === origin);
  } catch {
    return false;
  }
}

async function send(tabId: number, request: BridgeRequest, timeout = 20_000): Promise<BridgeResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      chrome.tabs.sendMessage(tabId, request),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Bridge timeout")), timeout);
      }),
    ]);
    if (!response || typeof (response as BridgeResponse).ok !== "boolean") {
      throw new Error("Invalid bridge response");
    }
    return response as BridgeResponse;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestViaBridge(request: BridgeRequest, open = false): Promise<BridgeResponse> {
  try {
    let tabs = (await chrome.tabs.query({ url: APP_ORIGINS.map((origin) => `${origin}/*`) }))
      .filter((tab) => tab.id !== undefined && isAppOriginUrl(tab.url))
      .sort((a, b) => Number(b.active) - Number(a.active));

    const origin = tabs[0]?.url ? new URL(tabs[0].url).origin : APP_ORIGIN;
    tabs = tabs.filter((tab) => new URL(tab.url!).origin === origin);

    if (!tabs.length && open) {
      tabs = [await chrome.tabs.create({ url: `${origin}`, active: true })];
    }
    if (!tabs.length) {
      return { ok: false, message: "Open Circles in a browser tab first." };
    }

    const deadline = Date.now() + 6_000;
    do {
      for (const tab of tabs) {
        let ready = false;
        try {
          ready = (await send(tab.id!, { type: "BRIDGE_PING" }, 750)).ok;
        } catch {
          /* try another tab */
        }
        if (ready) {
          try {
            return await send(tab.id!, request);
          } catch {
            return { ok: false, message: "Circles did not confirm the request. Check the app before retrying." };
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);

    return { ok: false, message: "Reload your Circles tab once to activate the companion bridge." };
  } catch {
    return { ok: false, message: "Could not reach the Circles app tab." };
  }
}

export const requestConnectBridge = (request: BridgeRequest) => requestViaBridge(request, true);
