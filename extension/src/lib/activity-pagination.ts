/** Safe diagnostic metadata from an observed activity response. */
export function activityPageEvidence(url: string, payload: unknown) {
  let request: URL;
  try { request = new URL(url); } catch { return null; }
  if (request.origin !== "https://substack.com" || request.pathname !== "/api/v1/activity-feed-web") return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const page = payload as Record<string, unknown>;
  if (!Array.isArray(page.activityItems)) return null;
  const date = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const last = page.activityItems.at(-1);
  const item = last && typeof last === "object" && !Array.isArray(last) ? last as Record<string, unknown> : {};
  return {
    after: date(request.searchParams.get("after")),
    more: typeof page.more === "boolean" ? page.more : null,
    count: page.activityItems.length,
    lastCreatedAt: date(item.created_at),
    lastUpdatedAt: date(item.updated_at),
  };
}

function activityTimestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("Activity pagination timestamp is missing or invalid.");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error("Activity pagination timestamp is missing or invalid.");
  return time;
}

/** Three calendar months in UTC, clamped for shorter months; freeze this once per job. */
export function activityBackfillCutoff(startedAt: string): string {
  const start = new Date(activityTimestamp(startedAt));
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 3);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return start.toISOString();
}

export function activityBackfillUrl(after: string | null): string {
  const url = new URL("https://substack.com/api/v1/activity-feed-web?filter=all");
  if (after !== null) { activityTimestamp(after); url.searchParams.set("after", after); }
  return url.href;
}

/**
 * Verified against native Substack requests supplied September 2026:
 * after = last activity item's updated_at minus 1 ms (not created_at).
 * This is a pure plan. A runner must save the page successfully BEFORE committing nextAfter.
 */
export function planActivityBackfillPage(payload: unknown, after: string | null, cutoff: string) {
  const boundary = activityTimestamp(cutoff);
  const cursor = after === null ? null : activityTimestamp(after);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid activity page.");
  const page = payload as Record<string, unknown>;
  if (!Array.isArray(page.activityItems) || page.activityItems.length > 500 || typeof page.more !== "boolean") throw new Error("Invalid activity page or missing pagination metadata.");
  if (!page.activityItems.length) {
    if (page.more) throw new Error("Empty activity page reports more history; pause instead of guessing a cursor.");
    return { payload: { ...page, activityItems: [] }, nextAfter: null, oldestUpdatedAt: null, reason: "exhausted" as const, count: 0 };
  }
  const dates = page.activityItems.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid activity item.");
    return activityTimestamp((item as Record<string, unknown>).updated_at);
  });
  for (let index = 0; index < dates.length; index++) {
    const current = dates[index]!;
    const previous = dates[index - 1];
    if (index > 0 && previous !== undefined && current > previous) throw new Error("Activity page is not ordered newest first; pause backfill.");
    if (cursor !== null && current > cursor) throw new Error("Activity page ignored its history cursor; pause backfill.");
  }
  const oldest = dates[dates.length - 1];
  if (oldest === undefined) throw new Error("Missing dates in activity page.");
  const next = oldest - 1;
  if (cursor !== null && next >= cursor) throw new Error("Activity cursor did not advance; pause backfill.");
  const reachedCutoff = next < boundary;
  const reason = reachedCutoff ? "cutoff" as const : !page.more ? "exhausted" as const : "continue" as const;
  // Keep response lookup tables intact. Only select activity items by their latest activity date.
  const items = page.activityItems.filter((_: unknown, index: number) => (dates[index] ?? 0) >= boundary);
  return { payload: { ...page, activityItems: items }, nextAfter: reason === "continue" ? new Date(next).toISOString() : null,
    oldestUpdatedAt: new Date(oldest).toISOString(), reason, count: items.length };
}
