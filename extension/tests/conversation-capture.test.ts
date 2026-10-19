import { describe, expect, it } from "bun:test";
import { conversationTarget, normalizeConversationResponse, validateCapturedConversation } from "../src/lib/conversation-capture";

const url = "https://substack.com/api/v1/reader/comment/42/replies?cursor=secret&token=private";
const branch = { comment: { id: 100, body: "Hello", date: "2026-09-15T00:00:00Z", user: { id: 1, name: "Ada", handle: "ada", sessionToken: "secret" } }, descendantComments: [{ comment: { id: 101, body: "Reply", handle: "owner" }, descendantComments: [] }] };
describe("passive conversation normalization", () => {
  it("captures nested notes, root context and pagination without credentials", () => {
    const result = normalizeConversationResponse(url, { commentBranches: [branch], rootComment: { id: 42, body: "Original note", handle: "writer" }, moreBranches: 2, nextCursor: "next", sessionToken: "secret" })!;
    expect(result.targetType).toBe("note");
    expect(result.comments[0]!.children[0]!.body).toBe("Reply");
    expect(result.rootAuthor?.authorHandle).toBe("writer");
    expect(result.moreComments).toBe(2);
    expect(result.nextCursor).toBe("next");
    expect(result.sourceUrl).not.toContain("?");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(validateCapturedConversation(result)).toEqual(result);
  });
  it("captures post comments with children without trimming full bodies", () => {
    const body = "x".repeat(15_000);
    const result = normalizeConversationResponse("https://writer.substack.com/api/v1/post/9/comments", { comments: [{ id: 200, body, name: "Ada", handle: "ada", children: [{ id: 201, body: "Nested", handle: "owner" }] }] })!;
    expect(result.targetType).toBe("post");
    expect(result.comments[0]!.body).toHaveLength(15_000);
    expect(result.comments[0]!.children).toHaveLength(1);
    expect(validateCapturedConversation(result)).toEqual(result);
  });
  it("rejects unrelated endpoints, hostile hosts and mismatched targets", () => {
    expect(conversationTarget("https://substack.com.evil.test/api/v1/post/9/comments")).toBeNull();
    expect(conversationTarget("https://substack.com/api/v1/firehose/batch")).toBeNull();
    expect(normalizeConversationResponse(url, { unrelated: [] })).toBeNull();
    const result = normalizeConversationResponse(url, { commentBranches: [branch] })!;
    expect(() => validateCapturedConversation({ ...result, targetId: "99" })).toThrow();
  });
  it("fails explicitly instead of silently dropping oversized trees", () => {
    expect(() => normalizeConversationResponse(url, { commentBranches: Array.from({ length: 1001 }, (_, id) => ({ id: id + 1, body: "Hello" })) })).toThrow(/safety limits/);
  });
  it("preserves an empty paginated response without inventing interactions", () => {
    expect(normalizeConversationResponse(url, { commentBranches: [], moreBranches: 3, nextCursor: "next" })?.comments).toEqual([]);
  });
});
