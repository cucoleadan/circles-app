import type { BackgroundResponse, BridgeRequest, BridgeResponse } from "./types";
import { validateCapturedConversation } from "./conversation-capture";
import type { CapturedOutboundAction } from "./outbound-action";

const KEY = "pendingActivityV1";
const CONNECTION_KEY = "activityConnectionId";
export const ACTIVITY_RETRY_ALARM = "retry-captured-activity";
type Batch = { id: string; connectionId: string; payload: unknown; attempts: number; retryAt: number };
type State = { batches: Batch[]; delivered: string[] };
let serial: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = serial.then(work);
  serial = result.catch(() => undefined);
  return result;
}
async function read(): Promise<State> {
  const stored = await chrome.storage.local.get(KEY);
  return (stored[KEY] as State | undefined) ?? { batches: [], delivered: [] };
}
function validateOutboundAction(value: unknown): CapturedOutboundAction | null {
  const item = value as Partial<CapturedOutboundAction> | null;
  const actions = new Set(["like", "restack", "comment", "reply"]);
  const targetKinds = new Set(["note", "post", "comment"]);
  if (
    item?.kind !== "outbound-action" ||
    !actions.has(String(item.action)) ||
    typeof item.active !== "boolean" ||
    typeof item.externalId !== "string" || item.externalId.length > 500 ||
    typeof item.targetId !== "string" || item.targetId.length > 500 ||
    !targetKinds.has(String(item.targetKind)) ||
    typeof item.targetUrl !== "string" || item.targetUrl.length > 2_000 ||
    typeof item.occurredAt !== "string" || !Number.isFinite(Date.parse(item.occurredAt))
  ) return null;
  if (item.targetAuthor !== null && (
    typeof item.targetAuthor !== "object" ||
    typeof item.targetAuthor.handle !== "string" ||
    item.targetAuthor.handle.length > 200 ||
    (item.targetAuthor.name !== null && typeof item.targetAuthor.name !== "string")
  )) return null;
  if (item.body !== null && (typeof item.body !== "string" || item.body.length > 100_000)) return null;
  return item as CapturedOutboundAction;
}
export async function rememberActivityConnection(response: BridgeResponse): Promise<void> {
  if (response.ok && response.appState?.connection) {
    await chrome.storage.local.set({ [CONNECTION_KEY]: response.appState.connection.id });
  }
}
export function enqueueActivity(payload: unknown): Promise<BackgroundResponse> {
  return exclusive(async () => {
    const items = (payload as { activityItems?: unknown } | null)?.activityItems;
    const conversation = (payload as { kind?: unknown } | null)?.kind === "conversation" ? validateCapturedConversation(payload) : null;
    const outboundAction = (payload as { kind?: unknown } | null)?.kind === "outbound-action" ? validateOutboundAction(payload) : null;
    if (!conversation && !outboundAction && !Array.isArray(items)) return { ok: false, message: "Invalid capture batch." };
    if (conversation) payload = conversation;
    if (outboundAction) payload = outboundAction;
    const captured = conversation ? conversation.comments.length : outboundAction ? 1 : (items as unknown[]).length;
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).length > 2_000_000) return { ok: false, message: "Activity batch exceeds capture size limit." };
    const stored = await chrome.storage.local.get(CONNECTION_KEY);
    const connectionId = stored[CONNECTION_KEY] as string | undefined;
    if (!connectionId) return { ok: false, message: "Open your connected Circles app once to enable durable capture." };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(connectionId + serialized));
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const state = await read();
    if (state.delivered.includes(id)) return { ok: true, captured };
    if (!state.batches.some((batch) => batch.id === id)) {
      state.batches.push({ id, connectionId, payload, attempts: 0, retryAt: 0 });
      if (state.batches.length > 100 || new TextEncoder().encode(JSON.stringify(state)).length > 4_000_000) {
        console.warn("[Circles Activity] Queue full; existing pending data preserved.");
        return { ok: false, message: "Capture queue full. Open Circles to deliver pending data." };
      }
      await chrome.storage.local.set({ [KEY]: state });
    }
    return { ok: true, queued: true, pendingBatches: state.batches.length, captured };
  });
}
export function drainActivity(bridge: (request: BridgeRequest) => Promise<BridgeResponse>): Promise<void> {
  return exclusive(async () => {
    const state = await read();
    if (!state.batches.some((batch) => batch.retryAt <= Date.now())) return;
    const app = await bridge({ type: "GET_APP_STATE" });
    const connection = app.ok ? app.appState?.connection : null;
    if (!connection) return;
    await rememberActivityConnection(app);
    // Keep each batch scoped to its original Circles connection.
    const due = state.batches.filter((batch) => batch.connectionId === connection.id && batch.retryAt <= Date.now()).slice(0, 5);
    for (const batch of due) {
      const result = await bridge({ type: "POST_ACTIVITY_BATCH", payload: { ...(batch.payload as object), expectedConnectionId: batch.connectionId } }).catch(() => ({ ok: false } as BridgeResponse));
      if (result.ok) {
        state.batches = state.batches.filter((pending) => pending.id !== batch.id);
        state.delivered = [...state.delivered, batch.id].slice(-100);
        console.log(`[Circles Activity] Delivered queued batch: ${result.captured ?? 0} items; ${result.newInteractions ?? 0} new interactions, ${result.enrichedInteractions ?? 0} enriched, ${result.newPeople ?? 0} new people; ${state.batches.length} pending.`);
      } else {
        batch.attempts++;
        batch.retryAt = Date.now() + Math.min(30, 2 ** Math.min(batch.attempts, 5)) * 60_000;
        console.warn("[Circles Activity] Delivery failed; batch retained for paced retry.");
      }
      await chrome.storage.local.set({ [KEY]: state });
      if (!result.ok) break;
    }
  });
}
