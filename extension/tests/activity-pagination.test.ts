import { describe, expect, it } from "vitest";
import { activityPageEvidence, activityBackfillCutoff, activityBackfillUrl, planActivityBackfillPage } from "../src/lib/activity-pagination";

describe("passive activity pagination evidence", () => {
  it("reports the observed cursor and distinct activity dates without guessing the next cursor", () => {
    const result = activityPageEvidence("https://substack.com/api/v1/activity-feed-web?filter=all&after=2026-09-09T01%3A00%3A21.148Z", {
      more: true, activityItems: [{ created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", user_id: "private", body: "private" }],
    });
    expect(result).toEqual({ after: "2026-09-09T01:00:21.148Z", more: true, count: 1, lastCreatedAt: "2026-09-07T00:00:00.000Z", lastUpdatedAt: "2026-09-08T00:00:00.000Z" });
  });
  it("distinguishes exhaustion from missing pagination metadata", () => {
    const url = "https://substack.com/api/v1/activity-feed-web?filter=all";
    expect(activityPageEvidence(url, { more: false, activityItems: [] })?.more).toBe(false);
    expect(activityPageEvidence(url, { activityItems: [] })?.more).toBeNull();
    expect(activityPageEvidence(url, { activityItems: [{ created_at: "invalid" }] })?.lastCreatedAt).toBeNull();
  });
  it("rejects unrelated responses and does not mutate the original capture", () => {
    const payload = { more: true, activityItems: [] };
    expect(activityPageEvidence("https://example.com/api/v1/activity-feed-web", payload)).toBeNull();
    expect(activityPageEvidence("https://substack.com/api/v1/reader/feed", payload)).toBeNull();
    expect(activityPageEvidence("https://substack.com/api/v1/activity-feed-web", {})).toBeNull();
    activityPageEvidence("https://substack.com/api/v1/activity-feed-web", payload);
    expect(payload).toEqual({ more: true, activityItems: [] });
  });
});

describe("verified historical activity pagination", () => {
  const cutoff = "2026-06-15T00:00:00.000Z";
  const item = (updated_at: string, created_at = updated_at) => ({ updated_at, created_at });
  it("reproduces the native next request exactly using updated_at minus one millisecond", () => {
    const page = { more: true, users: [{ id: 1 }], activityItems: [item("2026-09-06T03:32:00.470Z", "2026-04-07T13:34:09.547Z"), item("2026-09-05T21:53:10.058Z", "2026-09-05T21:53:10.062Z")] };
    const plan = planActivityBackfillPage(page, "2026-09-09T01:00:21.148Z", cutoff);
    expect(plan.nextAfter).toBe("2026-09-05T21:53:10.057Z");
    expect(activityBackfillUrl(plan.nextAfter)).toBe("https://substack.com/api/v1/activity-feed-web?filter=all&after=2026-09-05T21%3A53%3A10.057Z");
    expect(plan.count).toBe(2);
    expect(plan.payload.users).toBe(page.users);
    expect(page.activityItems).toHaveLength(2);
  });
  it("uses a fixed three-calendar-month cutoff with month-end clamping", () => {
    expect(activityBackfillCutoff("2026-09-15T11:00:00.000Z")).toBe("2026-06-15T11:00:00.000Z");
    expect(activityBackfillCutoff("2026-05-31T11:00:00.000Z")).toBe("2026-02-28T11:00:00.000Z");
    expect(activityBackfillCutoff("2024-05-31T11:00:00.000Z")).toBe("2024-02-29T11:00:00.000Z");
  });
  it("includes the cutoff boundary and stops before fetching beyond it", () => {
    const plan = planActivityBackfillPage({ more: true, activityItems: [item(cutoff), item("2026-06-14T00:00:00.000Z")] }, null, cutoff);
    expect(plan).toMatchObject({ reason: "cutoff", nextAfter: null, count: 1 });
  });
  it("reports upstream exhaustion separately from reaching the requested date", () => {
    expect(planActivityBackfillPage({ more: false, activityItems: [item("2026-09-01T00:00:00.000Z")] }, null, cutoff).reason).toBe("exhausted");
    expect(planActivityBackfillPage({ more: false, activityItems: [] }, null, cutoff).reason).toBe("exhausted");
  });
  it("pauses on unknown metadata, malformed dates, ignored cursors or unordered pages", () => {
    expect(() => planActivityBackfillPage({ activityItems: [] }, null, cutoff)).toThrow();
    expect(() => planActivityBackfillPage({ more: true, activityItems: [] }, null, cutoff)).toThrow();
    expect(() => planActivityBackfillPage({ more: true, activityItems: [item("invalid")] }, null, cutoff)).toThrow();
    expect(() => planActivityBackfillPage({ more: true, activityItems: [item("2026-09-02T00:00:00.000Z")] }, "2026-09-01T00:00:00.000Z", cutoff)).toThrow(/ignored/);
    expect(() => planActivityBackfillPage({ more: true, activityItems: [item("2026-09-01T00:00:00.000Z"), item("2026-09-02T00:00:00.000Z")] }, null, cutoff)).toThrow(/ordered/);
    expect(() => activityBackfillUrl("2026-02-30T00:00:00.000Z")).toThrow();
  });
});
