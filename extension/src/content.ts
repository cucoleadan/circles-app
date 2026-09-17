import { EXTENSION_HEADER, EXTENSION_HEADER_VALUE } from "./lib/constants";
import type { BridgeRequest, BridgeResponse } from "./lib/types";

const ORIGIN = window.location.origin;

function extensionHeaders(): Record<string, string> {
  return { [EXTENSION_HEADER]: EXTENSION_HEADER_VALUE };
}

function formValue(form: FormData, name: string, value: string | null): FormData {
  if (value) form.set(name, value);
  return form;
}

function submitResult(data: unknown): { ok: boolean; message?: string } {
  const record = data as { ok?: boolean; message?: string } | null;
  const ok = record?.ok === true;
  return {
    ok,
    message: record?.message ?? (ok ? "Saved." : "Failed."),
  };
}

async function getAppState(): Promise<BridgeResponse> {
  console.log("[StackedHQ Companion Bridge] Fetching app state from StackedHQ app...");
  try {
    const response = await fetch(`${ORIGIN}/api/ext/companion`, {
      signal: AbortSignal.timeout(15_000),
      headers: extensionHeaders(),
      credentials: "same-origin",
    });
    if (response.redirected && response.url.includes("/sign-in")) {
      console.warn("[StackedHQ Companion Bridge] App session is unauthenticated (redirected to /sign-in).");
      return { ok: false, needsAuth: true, message: "Log in to StackedHQ first." };
    }
    if (!response.ok) {
      console.error(`[StackedHQ Companion Bridge] App returned status ${response.status}.`);
      return { ok: false, message: `StackedHQ app bridge is not ready yet (${response.status}).` };
    }
    const appState = (await response.json()) as BridgeResponse["appState"];
    console.log(
      "%c[StackedHQ Companion Bridge] App state loaded:",
      "color: #10b981; font-weight: bold;",
      {
        connected: Boolean(appState?.connection),
        handlesCount: appState?.handles?.length ?? 0,
        listsCount: appState?.lists?.length ?? 0,
      },
    );
    return { ok: true, appState };
  } catch (error) {
    console.error("[StackedHQ Companion Bridge] Error connecting to StackedHQ:", error);
    return { ok: false, message: "Could not reach StackedHQ." };
  }
}

async function postForm(path: string, form: FormData): Promise<BridgeResponse> {
  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: extensionHeaders(),
      body: form,
      credentials: "same-origin",
    });
    if (response.redirected && response.url.includes("/sign-in")) {
      return { ok: false, needsAuth: true, message: "Log in to StackedHQ first." };
    }
    if (!response.ok) {
      return { ok: false, message: `StackedHQ returned ${response.status}.` };
    }
    const data: unknown = await response.json().catch(() => null);
    return { ok: submitResult(data).ok, submit: submitResult(data) };
  } catch {
    return { ok: false, message: "Could not reach StackedHQ." };
  }
}

async function postJson(path: string, value: unknown): Promise<BridgeResponse> {
  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: {
        ...extensionHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
      credentials: "same-origin",
    });
    if (response.redirected && response.url.includes("/sign-in")) {
      return { ok: false, needsAuth: true, message: "Log in to StackedHQ first." };
    }
    if (!response.ok) {
      return { ok: false, message: `StackedHQ returned ${response.status}.` };
    }
    const data = await response.json().catch(() => null) as {
      ok?: boolean;
      message?: string;
      captured?: number;
      processedItems?: number;
      newInteractions?: number;
      enrichedInteractions?: number;
      newPeople?: number;
      updatedPeople?: number;
    } | null;
    return {
      ok: data?.ok === true,
      message: data?.message,
      captured: data?.captured,
      processedItems: data?.processedItems,
      newInteractions: data?.newInteractions,
      enrichedInteractions: data?.enrichedInteractions,
      newPeople: data?.newPeople,
      updatedPeople: data?.updatedPeople,
    };
  } catch {
    return { ok: false, message: "Could not reach StackedHQ." };
  }
}

async function handle(request: BridgeRequest): Promise<BridgeResponse> {
  switch (request.type) {
    case "BRIDGE_PING":
      return { ok: true };
    case "GET_APP_STATE":
      return getAppState();
    case "POST_CONNECT": {
      const form = new FormData();
      form.set("intent", "connect");
      form.set("envelope", JSON.stringify(request.envelope));
      formValue(form, "publicationUrl", request.publicationUrl);
      return postForm("/app/settings", form);
    }
    case "POST_INSTALL": {
      const form = new FormData();
      form.set("intent", "install");
      return postForm("/app/companion", form);
    }
    case "POST_ACTIVITY_BATCH": {
      const count = Array.isArray(
        (request.payload as { activityItems?: unknown } | null)?.activityItems,
      )
        ? ((request.payload as { activityItems: unknown[] }).activityItems.length)
        : 0;
      console.log(`[StackedHQ Companion Bridge] Sending ${count} captured activity items to StackedHQ.`);
      const result = await postJson("/api/ext/activity", request.payload);
      if (result.ok) {
        console.log(
          `[StackedHQ Companion Bridge] Capture stored: ${result.newInteractions ?? 0} new interactions, ${result.enrichedInteractions ?? 0} enriched, ` +
            `${result.newPeople ?? 0} new people.`,
        );
        window.dispatchEvent(new CustomEvent("stackedhq:activity-captured"));
      } else {
        console.warn(
          `[StackedHQ Companion Bridge] Activity capture failed. ${result.message ?? "Scheduled sync will retry."}`,
        );
      }
      return result;
    }
    case "POST_CREATE_PERSON": {
      const form = new FormData();
      form.set("intent", "createPerson");
      form.set("name", request.name);
      form.set("handle", request.handle);
      for (const listId of request.lists) form.append("lists", listId);
      for (const tag of request.tags) form.append("tags", tag);
      return postForm("/app/community", form);
    }
  }
}

chrome.runtime.onMessage.addListener(
  (request: BridgeRequest, _sender, sendResponse) => {
    if (!["BRIDGE_PING", "GET_APP_STATE", "POST_CONNECT", "POST_INSTALL", "POST_ACTIVITY_BATCH", "POST_CREATE_PERSON"].includes(request?.type)) return;
    void handle(request).then(sendResponse).catch(() => sendResponse({ ok: false, message: "App bridge request failed." }));
    return true;
  },
);

document.documentElement.dataset.stackedhqExtension = "v1";
window.dispatchEvent(new CustomEvent("stackedhq:extension-detected"));

chrome.runtime.sendMessage({ type: "APP_PAGE_LOADED" }).catch(() => undefined);

window.addEventListener("stackedhq:connect-request", () => {
  void chrome.runtime.sendMessage({ type: "connect-from-app" }).catch(() => undefined);
});

window.addEventListener("stackedhq:submit-publication", (event) => {
  const detail = (
    event as CustomEvent<{ flowId?: string; publicationUrl?: string | null }>
  ).detail;
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
    window.dispatchEvent(
      new CustomEvent("stackedhq:flow-changed", { detail: record.flow }),
    );
  }
});
