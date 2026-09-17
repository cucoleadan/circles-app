import { describe, expect, it } from "vitest";
import { ingestNoteRepliesIntoRelationships } from "../../app/features/community/relationship-ingestion.server";
import type { CapturedReply } from "../src/lib/conversation-capture";

const reply = (id: string, handle: string, children: CapturedReply[] = []): CapturedReply => ({
  id, authorHandle: handle, authorName: handle, authorId: null, authorPhotoUrl: null,
  body: "Full comment body", createdAt: "2026-09-15T00:00:00Z", children,
});
function database() {
  const interactions: unknown[][] = [];
  const db = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async all() { return { results: [] }; },
      async first() { return { total_interactions: 2, total_conversations: 1, first_at: "2026-09-15T00:00:00Z", last_at: "2026-09-15T00:00:00Z" }; },
      async run() { if (sql.includes("INSERT INTO community_interactions")) interactions.push(values); return { meta: { changes: 1 } }; },
    };
    return statement;
  } };
  return { db, interactions };
}
describe("passive conversation ingestion", () => {
  it("stores post comments and owner replies with post-scoped roots", async () => {
    const { db, interactions } = database();
    const stats = await ingestNoteRepliesIntoRelationships({ db: db as never, userId: "user", ownerHandle: "owner", targetType: "post", sourceUrl: "https://writer.substack.com/api/v1/post/9/comments", replies: { noteId: "9", moreComments: 0, comments: [reply("100", "ada", [reply("101", "owner")])] } });
    expect(stats.processedReplies).toBe(2);
    expect(interactions[0]!.slice(3, 9)).toEqual(["comment:100", "inbound", "comment", "post", "9", "post:9"]);
    expect(interactions[1]!.slice(3, 9)).toEqual(["comment:101", "outbound", "reply", "comment", "100", "post:9"]);
  });
  it("associates a direct owner reply with the original Note author without logging the Note as a comment", async () => {
    const { db, interactions } = database();
    await ingestNoteRepliesIntoRelationships({ db: db as never, userId: "user", ownerHandle: "owner", rootAuthor: reply("42", "ada"), replies: { noteId: "42", moreComments: 0, comments: [reply("102", "owner")] } });
    expect(interactions).toHaveLength(1);
    expect(interactions[0]![3]).toBe("comment:102");
    expect(interactions[0]![4]).toBe("outbound");
  });
});
