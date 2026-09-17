import { parseCompanionResponse } from "./lib/companion-response";
import type { BridgeRequest, BridgeResponse } from "./lib/types";

const ORIGIN = window.location.origin;

function extensionHeaders(): Record<string, string> {
  return {
    "X-Circles-Extension": "v1",
  };
}

function submitResult(data: unknown): { ok: boolean; message?: string } {
  const record = data as { ok?: boolean; message?: string; submit?: { ok?: boolean; message?: string } } | null;
  const ok = record?.ok === true || record?.submit?.ok === true;
  return {
    ok,
    message: record?.submit?.message ?? record?.message ?? (ok ? "Saved." : "Failed."),
  };
}

async function getAppState(): Promise<BridgeResponse> {
  try {
    const response = await fetch(`${ORIGIN}/api/ext/companion`, {
      signal: AbortSignal.timeout(15_000),
      headers: extensionHeaders(),
      credentials: "same-origin",
    });
    if (response.redirected && response.url.includes("/login")) {
      return { ok: false, needsAuth: true, message: "Log in to Circles first." };
    }
    if (!response.ok) {
      return { ok: false, message: `Circles returned ${response.status}.` };
    }
    return parseCompanionResponse(await response.json());
  } catch (error) {
    console.warn("[Circles Companion Bridge] Error connecting to Circles:", error);
    return { ok: false, message: "Could not reach Circles." };
  }
}

async function postJson(path: string, value: unknown): Promise<BridgeResponse> {
  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      signal: AbortSignal.timeout(20_000),
      method: "POST",
      headers: {
        ...extensionHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
      credentials: "same-origin",
    });
    if (response.redirected && response.url.includes("/login")) {
      return { ok: false, needsAuth: true, message: "Log in to Circles first." };
    }
    if (!response.ok) {
      const errJson = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, message: errJson?.message ?? `Circles returned ${response.status}.` };
    }
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      captured?: number;
      processedItems?: number;
      newInteractions?: number;
      enrichedInteractions?: number;
      newPeople?: number;
      updatedPeople?: number;
      submit?: { ok?: boolean; message?: string };
    } | null;

    const result = submitResult(data);
    return {
      ok: result.ok,
      message: result.message,
      submit: {
        ok: Boolean(data?.submit?.ok ?? result.ok),
        message: data?.submit?.message ?? result.message,
      },
      captured: data?.captured,
      processedItems: data?.processedItems,
      newInteractions: data?.newInteractions,
      enrichedInteractions: data?.enrichedInteractions,
      newPeople: data?.newPeople,
      updatedPeople: data?.updatedPeople,
    };
  } catch {
    return { ok: false, message: "Could not reach Circles." };
  }
}

async function handle(request: BridgeRequest): Promise<BridgeResponse> {
  switch (request.type) {
    case "BRIDGE_PING":
      return { ok: true };

    case "GET_APP_STATE":
      return getAppState();

    case "POST_CONNECT": {
      return postJson("/api/ext/connect", {
        sessionToken: request.sessionToken,
        publicationUrl: request.publicationUrl,
      });
    }

    case "POST_INSTALL": {
      return postJson("/api/ext/install", {});
    }

    case "POST_ACTIVITY_BATCH": {
      const result = await postJson("/api/ext/activity", request.payload);
      if (result.ok) {
        window.dispatchEvent(new CustomEvent("circles:activity-captured"));
      }
      return result;
    }

    case "POST_CREATE_PERSON": {
      return postJson("/api/ext/person", {
        name: request.name,
        handle: request.handle,
        lists: request.lists,
        tags: request.tags,
      });
    }
  }
}

chrome.runtime.onMessage.addListener((request: BridgeRequest, _sender, sendResponse) => {
  if (
    !["BRIDGE_PING", "GET_APP_STATE", "POST_CONNECT", "POST_INSTALL", "POST_ACTIVITY_BATCH", "POST_CREATE_PERSON"].includes(
      request?.type,
    )
  )
    return;
  void handle(request)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, message: "Circles bridge request failed." }));
  return true;
});

document.documentElement.dataset.circlesExtension = "v1";
window.dispatchEvent(new CustomEvent("circles:extension-detected"));

chrome.runtime.sendMessage({ type: "APP_PAGE_LOADED" }).catch(() => undefined);

window.addEventListener("circles:connect-request", () => {
  void chrome.runtime.sendMessage({ type: "connect-from-app" }).catch(() => undefined);
});

window.addEventListener("circles:submit-publication", (event) => {
  const detail = (event as CustomEvent<{ flowId?: string; publicationUrl?: string | null }>).detail;
  if (!detail?.flowId) return;
  void chrome.runtime
    .sendMessage({
      type: "SUBMIT_PUBLICATION_URL",
      flowId: detail.flowId,
      publicationUrl: detail.publicationUrl ?? null,
    })
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const record = message as { type?: string; flow?: unknown };
  if (record.type === "FLOW_CHANGED") {
    window.dispatchEvent(new CustomEvent("circles:flow-changed", { detail: record.flow }));
  }
});
