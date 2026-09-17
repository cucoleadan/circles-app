import type { GatewayActivityItem } from "../../services/gateway/activity.server";

export type BackfillJob = {
  connection_id: string; status: "running" | "paused" | "complete"; started_at: string; cutoff: string;
  after_cursor: string | null; oldest_at: string | null; finish_reason: "cutoff" | "exhausted" | null;
  pages: number; items: number; new_interactions: number; enriched_interactions: number; new_people: number;
  next_request_at: number; lease_until: number; error: string | null;
};
export type BackfillPage = { items: GatewayActivityItem[]; notificationCount?: number; nextAfter: string | null; oldestAt: string | null; reason: "cutoff" | "exhausted" | "continue" };
export function backfillCutoff(startedAt: string) {
  const date = new Date(startedAt);
  const day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 3);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
export function backfillTimestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Invalid activity pagination timestamp.");
  return Date.parse(value);
}
