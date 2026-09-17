export {};

const MESSAGE_SOURCE = "stackedhq-page-observer";
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
    !["ACTIVITY_RESPONSE", "CONVERSATION_RESPONSE"].includes(message.type ?? "") ||
    !(Array.isArray(message.payload?.activityItems) || (message.payload?.kind === "conversation" && Array.isArray(message.payload.comments)))
  ) return;

  const items = message.payload!.activityItems ?? message.payload!.comments!;
  const batchKey = JSON.stringify(message.payload);
  if (observedActivityBatches.has(batchKey)) {
    console.log(`[StackedHQ Activity] Skipped duplicate batch (${items.length} items).`);
    return;
  }

  console.log(`[StackedHQ Activity] Forwarding ${items.length} captured items to StackedHQ.`);
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
          ? `[StackedHQ Activity] Safely queued ${items.length} items locally; ${result.pendingBatches ?? 0} batches awaiting delivery.`
          : `[StackedHQ Activity] Batch already delivered (${items.length} items).`,
      );
    } else {
      console.warn(
        `[StackedHQ Activity] Capture was not queued; reload Activity to retry. ${result?.message ?? ""}`.trim(),
      );
    }
  }).catch((error: unknown) => {
    console.warn("[StackedHQ Activity] Could not reach the extension background worker; scheduled sync remains the fallback.", error);
  });
});
