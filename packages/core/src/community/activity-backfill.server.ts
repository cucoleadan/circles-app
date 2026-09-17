import type { BackfillPage } from "./activity-backfill";
import { ActivityBackfillReadError, getGatewayActivityPage } from "../../services/gateway/activity.server";
import { getGatewayConnection } from "../connections/connection.repository.server";
import { ingestActivityIntoRelationships } from "./relationship-ingestion.server";
import { claimActivityBackfill, failBackfillPage, finishBackfillPage, savePendingBackfillPage } from "./activity-backfill.repository.server";

export async function stepActivityBackfill(db: D1Database, userId: string) {
  const token = crypto.randomUUID();
  const job = await claimActivityBackfill(db, userId, token);
  if (!job) return;
  try {
    const connection = await getGatewayConnection(db, userId);
    if (!connection?.publicationUrl || connection.id !== job.connection_id) throw new Error("The Substack connection changed or is unavailable. Reconnect the original account before resuming.");
    const page: BackfillPage = job.pending_json ? JSON.parse(job.pending_json) : await getGatewayActivityPage({ envelope: connection.envelope, publicationUrl: connection.publicationUrl, after: job.after_cursor, cutoff: job.cutoff });
    if (!job.pending_json) await savePendingBackfillPage(db, userId, token, page);
    const stats = await ingestActivityIntoRelationships({ db, userId, items: page.items, ownerHandle: connection.profile.handle, strict: true });
    await finishBackfillPage(db, userId, token, page, stats);
    console.log(`[StackedHQ Backfill] Saved page ${job.pages + 1}: ${page.items.length} items, ${stats.newInteractions} new, ${stats.enrichedInteractions} enriched; ${page.reason}; oldest ${page.oldestAt ?? "none"}.`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Historical import failed. Your cursor is preserved.";
    await failBackfillPage(db, userId, token, message, cause instanceof ActivityBackfillReadError ? cause.retryAt : Date.now() + 60_000);
    console.warn("[StackedHQ Backfill] Import paused; checkpoint retained.");
  }
}
