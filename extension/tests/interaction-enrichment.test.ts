import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enrichCommunityInteraction } from "../../app/features/community/interaction-enrichment.server";
import { ingestNoteRepliesIntoRelationships } from "../../app/features/community/relationship-ingestion.server";

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE community_interactions (id TEXT, user_id TEXT, external_id TEXT, person_id TEXT, direction TEXT, body TEXT, target_title TEXT, target_url TEXT, thread_root_id TEXT, target_id TEXT, target_type TEXT, action_type TEXT, occurred_at TEXT, metadata_json TEXT, created_at TEXT, UNIQUE(user_id, external_id))");
  sqlite.prepare("INSERT INTO community_interactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("stable-id", "user-a", "comment:100", "person-a", "inbound", "Preview", "Original title", "https://writer.substack.com/p/post", "old-root", "100", "note", "comment", "2026-09-15T00:00:00Z", JSON.stringify({ actorName: "Ada", actorAvatarUrl: "https://cdn/avatar", targetTitle: "Original title" }), "2026-09-15T12:00:00Z");
  db = { prepare(sql: string) { return { bind(...values: unknown[]) { return {
    async run() { const result = sqlite.prepare(sql).run(...values as never[]); return { meta: { changes: Number(result.changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...values as never[]) }; },
    async first() { return sqlite.prepare(sql).get(...values as never[]) ?? null; },
  }; } }; } } as never;
});
afterEach(() => sqlite.close());
const capture = {
  body: "Full conversation body with substantially more context", threadRootId: "42", targetId: "99", targetType: "comment", actionType: "reply",
  occurredAt: "2026-09-14T00:00:00Z", metadata: { authorHandle: "ada", authorName: "Ada Lovelace", authorPhotoUrl: null }, source: "conversation" as const,
};
function row() { return sqlite.prepare("SELECT * FROM community_interactions WHERE user_id = 'user-a'").get()!; }
describe("interaction enrichment (real SQLite)", () => {
  it("reports an enriched existing interaction, not a new row, through reply ingestion", async () => {
    sqlite.exec("CREATE TABLE community_people (id TEXT, user_id TEXT, normalized_handle TEXT, interaction_count INTEGER, conversation_count INTEGER, first_interacted_at TEXT, last_engaged_at TEXT, drift_status TEXT, updated_at TEXT); INSERT INTO community_people (id, user_id, normalized_handle) VALUES ('person-a', 'user-a', 'ada')");
    const input = { db, userId: "user-a", ownerHandle: "owner", replies: { noteId: "42", moreComments: 0, comments: [{ id: "100", body: capture.body, createdAt: capture.occurredAt, authorName: "Ada", authorHandle: "ada", authorPhotoUrl: null, authorId: null, children: [] }] } };
    expect(await ingestNoteRepliesIntoRelationships(input)).toMatchObject({ newInteractions: 0, enrichedInteractions: 1 });
    expect(await ingestNoteRepliesIntoRelationships(input)).toMatchObject({ newInteractions: 0, enrichedInteractions: 0 });
    expect(sqlite.prepare("SELECT interaction_count FROM community_people").get()!.interaction_count).toBe(1);
  });
  it("upgrades body and thread context while retaining identity and earlier notification metadata", async () => {
    expect(await enrichCommunityInteraction(db, "user-a", "comment:100", capture)).toBe(true);
    expect(row()).toMatchObject({ id: "stable-id", person_id: "person-a", direction: "inbound", body: capture.body, thread_root_id: "42", target_id: "99", target_type: "comment", action_type: "reply", occurred_at: capture.occurredAt, target_title: "Original title", created_at: "2026-09-15T12:00:00Z" });
    expect(JSON.parse(row().metadata_json as string)).toMatchObject({ actorName: "Ada", actorAvatarUrl: "https://cdn/avatar", authorName: "Ada Lovelace", authorHandle: "ada" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM community_interactions").get()!.count).toBe(1);
  });
  it("is idempotent and does not downgrade a full reply with a later notification", async () => {
    await enrichCommunityInteraction(db, "user-a", "comment:100", capture);
    expect(await enrichCommunityInteraction(db, "user-a", "comment:100", capture)).toBe(false);
    await enrichCommunityInteraction(db, "user-a", "comment:100", { ...capture, source: "activity", body: "Short", threadRootId: "wrong", targetId: "100", targetType: "note", actionType: "comment", occurredAt: null, metadata: { authorName: "Old name", extra: "Useful new context" } });
    expect(row()).toMatchObject({ body: capture.body, thread_root_id: "42", target_id: "99", target_type: "comment", action_type: "reply", occurred_at: capture.occurredAt });
    expect(JSON.parse(row().metadata_json as string)).toMatchObject({ authorName: "Ada Lovelace", extra: "Useful new context" });
  });
  it("does not downgrade nested context with a shallow conversation response", async () => {
    await enrichCommunityInteraction(db, "user-a", "comment:100", capture);
    await enrichCommunityInteraction(db, "user-a", "comment:100", { ...capture, actionType: "comment", targetType: "note", targetId: "42", body: "Short", metadata: {} });
    expect(row()).toMatchObject({ target_type: "comment", target_id: "99", action_type: "reply", body: capture.body });
  });
  it("isolates users and handles legacy invalid JSON without deleting it on failed updates", async () => {
    const before = row();
    expect(await enrichCommunityInteraction(db, "user-b", "comment:100", capture)).toBe(false);
    expect(row()).toEqual(before);
    sqlite.exec("UPDATE community_interactions SET metadata_json = 'broken'");
    expect(await enrichCommunityInteraction(db, "user-a", "comment:100", capture)).toBe(true);
    expect(JSON.parse(row().metadata_json as string)).toEqual({ authorHandle: "ada", authorName: "Ada Lovelace" });
  });
  it("upgrades an API URL to a usable human-facing link", async () => {
    sqlite.exec("UPDATE community_interactions SET target_url = 'https://substack.com/api/v1/reader/comment/42/replies'");
    await enrichCommunityInteraction(db, "user-a", "comment:100", { ...capture, source: "activity", targetUrl: "https://substack.com/@ada/note/c-42" });
    expect(row().target_url).toBe("https://substack.com/@ada/note/c-42");
  });
});
