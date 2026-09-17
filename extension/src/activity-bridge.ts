export {};

const MESSAGE_SOURCE = "circles-page-observer";
const observedActivityBatches = new Set<string>();

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data as {
    source?: string;
    type?: string;
    payload?: { kind?: string; comments?: unknown[]; activityItems?: Array<{ id?: unknown; item_key?: unknown }> };
  } | null;
  if (
    message?.source !== MESSAGE_SOURCE ||
    !["ACTIVITY_RESPONSE", "CONVERSATION_RESPONSE", "OUTBOUND_ACTION"].includes(message.type ?? "") ||
    !(
      Array.isArray(message.payload?.activityItems) ||
      (message.payload?.kind === "conversation" && Array.isArray(message.payload.comments)) ||
      message.payload?.kind === "outbound-action"
    )
  ) return;

  const items = message.payload!.kind === "outbound-action"
    ? [message.payload]
    : message.payload!.activityItems ?? message.payload!.comments!;
  const batchKey = JSON.stringify(message.payload);
  if (observedActivityBatches.has(batchKey)) {
    console.log(`[Circles Activity] Skipped duplicate batch (${items.length} items).`);
    return;
  }

  console.log(`[Circles Activity] Forwarding ${items.length} captured items to Circles.`);
  void chrome.runtime.sendMessage({
    type: "CAPTURE_ACTIVITY_BATCH",
    payload: message.payload,
  }).then((result: { ok?: boolean; queued?: boolean; pendingBatches?: number; captured?: number; newInteractions?: number; newPeople?: number; message?: string }) => {
    if (result?.ok) {
      observedActivityBatches.add(batchKey);
      if (observedActivityBatches.size > 20) {
        const oldest = observedActivityBatches.values().next().value;
        if (oldest !== undefined) observedActivityBatches.delete(oldest);
      }
      console.log(
        result.queued
          ? `[Circles Activity] Safely queued ${items.length} items locally; ${result.pendingBatches ?? 0} batches awaiting delivery.`
          : `[Circles Activity] Batch already delivered (${items.length} items).`,
      );
    } else {
      console.warn(
        `[Circles Activity] Capture was not queued; reload Activity to retry. ${result?.message ?? ""}`.trim(),
      );
    }
  }).catch((error: unknown) => {
    console.warn("[Circles Activity] Could not reach the extension background worker; scheduled sync remains the fallback.", error);
  });
});
