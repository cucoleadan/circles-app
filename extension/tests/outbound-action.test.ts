import { describe, expect, it } from "bun:test";
import { captureOutboundAction } from "../src/lib/outbound-action";

describe("outbound action capture", () => {
  it("captures a successful Note like with a stable identity", () => {
    expect(captureOutboundAction({
      requestUrl: "https://substack.com/api/v1/comment/123/reaction",
      method: "POST",
      body: JSON.stringify({ reaction: "❤" }),
      pageUrl: "https://substack.com/@alice/note/c-123",
      occurredAt: "2026-09-17T12:00:00.000Z",
    })).toMatchObject({
      action: "like",
      active: true,
      externalId: "outbound:like:comment:123",
      targetKind: "comment",
      targetAuthor: { handle: "alice" },
    });
  });

  it("uses the same identity when a Note is unliked", () => {
    expect(captureOutboundAction({
      requestUrl: "https://substack.com/api/v1/comment/123/reaction",
      method: "DELETE",
      pageUrl: "https://substack.com/@alice/note/c-123",
    })).toMatchObject({
      action: "like",
      active: false,
      externalId: "outbound:like:comment:123",
    });
  });

  it("does not misclassify publishing an owned Note as a reply", () => {
    expect(captureOutboundAction({
      requestUrl: "https://substack.com/api/v1/comment/feed",
      method: "POST",
      body: JSON.stringify({ bodyJson: { type: "doc" } }),
      pageUrl: "https://substack.com/home",
    })).toBeNull();
  });
});
