import { conversationTarget, normalizeConversationResponse } from "./lib/conversation-capture";
import { activityPageEvidence } from "./lib/activity-pagination";
import { captureOutboundAction } from "./lib/outbound-action";

const ACTIVITY_PATH = "/api/v1/activity-feed-web";
const MESSAGE_SOURCE = "circles-page-observer";
const MAX_CAPTURE_BYTES = 2_000_000;

function isActivityResponse(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "substack.com" || parsed.hostname.endsWith(".substack.com")) &&
      parsed.pathname === ACTIVITY_PATH;
  } catch {
    return false;
  }
}

function publishPayload(payload: unknown, transport: "fetch" | "xhr", url: string): void {
  try {
    const conversation = normalizeConversationResponse(new URL(url, window.location.href).href, payload);
    if (conversation) {
      if (new TextEncoder().encode(JSON.stringify(conversation)).length > MAX_CAPTURE_BYTES) throw new Error("Conversation exceeds upload size limit.");
      console.log(`[Circles Activity] Captured ${conversation.targetType} conversation from an existing ${transport} response; ${conversation.moreComments} more comments reported.`);
      window.postMessage({ source: MESSAGE_SOURCE, type: "CONVERSATION_RESPONSE", payload: conversation }, window.location.origin);
      return;
    }
    if (conversationTarget(new URL(url, window.location.href).href)) {
      console.warn("[Circles Activity] Unsupported response shape; conversation was not queued.");
      return;
    }
    const serialized = JSON.stringify(payload);
    if (serialized.length === 0 || serialized.length > MAX_CAPTURE_BYTES) {
      console.warn("[Circles Activity] Ignored an empty or oversized activity response.");
      return;
    }
    const record = payload as { activityItems?: unknown } | null;
    if (!record || !Array.isArray(record.activityItems)) return;
    console.log(
      `[Circles Activity] Detected ${record.activityItems.length} activity items from an existing Substack ${transport} response.`,
    );
    const evidence = activityPageEvidence(new URL(url, window.location.href).href, payload);
    if (evidence) console.log("[Circles Activity] Pagination evidence (no extra requests):", evidence);
    window.postMessage(
      { source: MESSAGE_SOURCE, type: "ACTIVITY_RESPONSE", payload },
      window.location.origin,
    );
  } catch (error) {
    console.warn("[Circles Activity] Response could not be captured completely.", error);
  }
}

function observeResponse(response: Response): void {
  if (!response.ok || !(isActivityResponse(response.url) || conversationTarget(response.url))) return;
  void response.clone().json().then((payload) => publishPayload(payload, "fetch", response.url)).catch(() => {
    console.warn("[Circles Activity] Could not read the observed Substack activity response.");
  });
}

function publishOutboundAction(input: Parameters<typeof captureOutboundAction>[0]): void {
  try {
    const action = captureOutboundAction(input);
    if (!action) return;
    console.log(
      `[Circles Activity] Captured outbound ${action.active ? action.action : `removed ${action.action}`} for ${action.targetKind} ${action.targetId}.`,
    );
    window.postMessage(
      { source: MESSAGE_SOURCE, type: "OUTBOUND_ACTION", payload: action },
      window.location.origin,
    );
  } catch (error) {
    console.warn("[Circles Activity] Outbound action could not be captured.", error);
  }
}

const originalFetch = window.fetch;
window.fetch = async function circlesObservedFetch(...args) {
  const [input, init] = args;
  const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const bodyPromise = init?.body !== undefined
    ? Promise.resolve(init.body)
    : input instanceof Request && !["GET", "HEAD"].includes(method.toUpperCase())
    ? input.clone().text().catch(() => undefined)
    : Promise.resolve(undefined);
  const response = await originalFetch.apply(this, args);
  observeResponse(response);
  if (response.ok) {
    const [body, responsePayload] = await Promise.all([
      bodyPromise,
      response.clone().json().catch(() => undefined),
    ]);
    publishOutboundAction({
      requestUrl,
      method,
      body,
      response: responsePayload,
      pageUrl: window.location.href,
    });
  }
  return response;
};

const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function circlesObservedOpen(
  method: string,
  url: string | URL,
  asyncFlag: boolean = true,
  username?: string | null,
  password?: string | null,
) {
  Object.defineProperty(this, "__circlesActivityUrl", {
    configurable: true,
    value: String(url),
  });
  Object.defineProperty(this, "__circlesActivityMethod", {
    configurable: true,
    value: method,
  });
  return originalOpen.call(this, method, url, asyncFlag, username, password);
};

XMLHttpRequest.prototype.send = function circlesObservedSend(body?: Document | XMLHttpRequestBodyInit | null) {
  this.addEventListener("load", () => {
    const observed = this as XMLHttpRequest & { __circlesActivityUrl?: string; __circlesActivityMethod?: string };
    const url = observed.__circlesActivityUrl;
    if (!url || this.status < 200 || this.status >= 300) return;
    try {
      const responsePayload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
      if (isActivityResponse(url) || conversationTarget(new URL(url, window.location.href).href)) {
        publishPayload(responsePayload, "xhr", url);
      }
      publishOutboundAction({
        requestUrl: url,
        method: observed.__circlesActivityMethod ?? "GET",
        body,
        response: responsePayload,
        pageUrl: window.location.href,
      });
    } catch {
      publishOutboundAction({
        requestUrl: url,
        method: observed.__circlesActivityMethod ?? "GET",
        body,
        pageUrl: window.location.href,
      });
    }
  }, { once: true });
  return originalSend.call(this, body);
};

console.log("[Circles Activity] Passive observer installed; no extra Substack requests will be made.");
