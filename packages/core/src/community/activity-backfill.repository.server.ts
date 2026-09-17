import { backfillCutoff } from "./activity-backfill";
import type { BackfillJob, BackfillPage } from "./activity-backfill";

const PUBLIC_COLUMNS = "connection_id, status, started_at, cutoff, after_cursor, oldest_at, finish_reason, pages, items, new_interactions, enriched_interactions, new_people, next_request_at, lease_until, error";
export function getActivityBackfill(db: D1Database, userId: string) {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM community_activity_backfills WHERE user_id = ?`).bind(userId).first<BackfillJob>();
}
export async function startActivityBackfill(db: D1Database, userId: string, connectionId: string, now = Date.now()) {
  const started = new Date(now).toISOString();
  await db.prepare("INSERT INTO community_activity_backfills (user_id, connection_id, status, started_at, cutoff) VALUES (?, ?, 'running', ?, ?) ON CONFLICT(user_id) DO UPDATE SET connection_id = excluded.connection_id, status = 'running', started_at = excluded.started_at, cutoff = excluded.cutoff, after_cursor = NULL, oldest_at = NULL, finish_reason = NULL, pages = 0, items = 0, new_interactions = 0, enriched_interactions = 0, new_people = 0, next_request_at = 0, lease_until = 0, lease_token = NULL, pending_json = NULL, error = NULL WHERE community_activity_backfills.status = 'complete' AND community_activity_backfills.lease_until <= ?").bind(userId, connectionId, started, backfillCutoff(started), now).run();
}
export async function setActivityBackfillStatus(db: D1Database, userId: string, status: "running" | "paused") {
  await db.prepare("UPDATE community_activity_backfills SET status = ?, error = CASE WHEN ? = 'running' THEN NULL ELSE error END WHERE user_id = ? AND status != 'complete'").bind(status, status, userId).run();
}
export async function claimActivityBackfill(db: D1Database, userId: string, token: string, now = Date.now()) {
  const row = await db.prepare(`UPDATE community_activity_backfills SET lease_token = ?, lease_until = ? WHERE user_id = ? AND status = 'running' AND next_request_at <= ? AND lease_until <= ? RETURNING ${PUBLIC_COLUMNS}, pending_json`).bind(token, now + 600_000, userId, now, now).first<BackfillJob & { pending_json: string | null }>();
  return row;
}
export async function savePendingBackfillPage(db: D1Database, userId: string, token: string, page: BackfillPage) {
  const json = JSON.stringify(page);
  if (new TextEncoder().encode(json).length > 750_000) throw new Error("Historical page exceeds checkpoint size. Import paused without advancing the cursor.");
  const result = await db.prepare("UPDATE community_activity_backfills SET pending_json = ? WHERE user_id = ? AND lease_token = ?").bind(json, userId, token).run();
  if (!result.meta.changes) throw new Error("Backfill lease was lost.");
}
export async function finishBackfillPage(db: D1Database, userId: string, token: string, page: BackfillPage, stats: { newInteractions: number; enrichedInteractions: number; newPeople: number }, now = Date.now()) {
  await db.prepare("UPDATE community_activity_backfills SET after_cursor = ?, oldest_at = COALESCE(?, oldest_at), finish_reason = ?, status = CASE WHEN ? != 'continue' THEN 'complete' ELSE status END, pages = pages + 1, items = items + ?, new_interactions = new_interactions + ?, enriched_interactions = enriched_interactions + ?, new_people = new_people + ?, pending_json = NULL, lease_until = 0, lease_token = NULL, next_request_at = ?, error = NULL WHERE user_id = ? AND lease_token = ?").bind(page.nextAfter, page.oldestAt, page.reason === "continue" ? null : page.reason, page.reason, page.notificationCount ?? page.items.length, stats.newInteractions, stats.enrichedInteractions, stats.newPeople, now + 2_000, userId, token).run();
}
export async function failBackfillPage(db: D1Database, userId: string, token: string, message: string, retryAt: number) {
  await db.prepare("UPDATE community_activity_backfills SET status = 'paused', error = ?, next_request_at = ?, lease_until = 0, lease_token = NULL WHERE user_id = ? AND lease_token = ?").bind(message, retryAt, userId, token).run();
}
