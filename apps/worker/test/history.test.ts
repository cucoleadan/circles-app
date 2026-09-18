import { describe, expect, test } from "bun:test"
import { normalizeOutboundProfileFeed, syncOwnedPostsPage } from "../src/history.js"

const ownerId = "44242110"

describe("profile outbound history normalization", () => {
  test("links Note likes and restacks to the target author's stable profile ID", () => {
    const items = normalizeOutboundProfileFeed([
      {
        context: { type: "note_like", source: "db-like", timestamp: "2026-09-01T10:00:00Z" },
        comment: { id: 101, type: "feed", user_id: 9001, handle: "alice", name: "Alice", body: "Alice's note" },
      },
      {
        context: { type: "comment_restack", source: "db-restack", timestamp: "2026-09-02T10:00:00Z" },
        comment: { id: 102, type: "feed", user_id: 9002, handle: "bob", name: "Bob" },
      },
    ], ownerId)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      action: "like",
      externalId: "outbound:like:note:101",
      targetKind: "note",
      targetBody: "Alice's note",
      targetUrl: "https://substack.com/@alice/note/c-101",
      targetAuthor: { id: "9001", handle: "alice" },
    })
    expect(items[1]).toMatchObject({
      action: "restack",
      externalId: "outbound:restack:note:102",
      targetAuthor: { id: "9002", handle: "bob" },
    })
  })

  test("uses the post byline as the contact for post likes and restacks", () => {
    const items = normalizeOutboundProfileFeed([
      {
        context: { type: "post_like", source: "db-like", timestamp: "2026-09-03T10:00:00Z" },
        post: {
          id: 201,
          title: "A post",
          canonical_url: "https://example.com/p/a-post",
          publishedBylines: [{ id: 9003, handle: "carol", name: "Carol" }],
        },
      },
      {
        context: { type: "post_restack", source: "db-restack", timestamp: "2026-09-04T10:00:00Z" },
        post: {
          id: 202,
          publishedBylines: [{ id: 9004, handle: "dave", name: "Dave" }],
        },
      },
    ], ownerId)

    expect(items[0]).toMatchObject({
      externalId: "outbound:like:post:201",
      targetAuthor: { id: "9003", handle: "carol" },
      threadKind: "post",
      threadRootId: "201",
    })
    expect(items[1]).toMatchObject({
      externalId: "outbound:restack:post:202",
      targetAuthor: { id: "9004", handle: "dave" },
    })
  })

  test("links a comment like to the comment author, not the enclosing post author", () => {
    const items = normalizeOutboundProfileFeed([
      {
        context: { type: "comment_like", source: "db-like", timestamp: "2026-09-04T12:00:00Z" },
        comment: { id: 250, type: "comment", user_id: 9006, handle: "frank", name: "Frank", post_id: 200, body: "Frank's comment" },
        post: {
          id: 200,
          publishedBylines: [{ id: 9999, handle: "post-author", name: "Post Author" }],
        },
      },
    ], ownerId)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      externalId: "outbound:like:comment:250",
      targetKind: "comment",
      targetId: "250",
      targetBody: "Frank's comment",
      targetAuthor: { id: "9006", handle: "frank" },
      threadKind: "post",
      threadRootId: "200",
    })
  })

  test("links authored replies to the nearest non-owner parent", () => {
    const items = normalizeOutboundProfileFeed([
      {
        context: { type: "note", source: "db-note", timestamp: "2026-09-05T10:00:00Z" },
        comment: {
          id: 303,
          user_id: Number(ownerId),
          body: "My reply",
          ancestor_path: "301.302",
        },
        parentComments: [
          { id: 301, user_id: Number(ownerId), handle: "owner", type: "feed" },
          { id: 302, user_id: 9005, handle: "erin", name: "Erin", type: "feed" },
        ],
      },
    ], ownerId)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      action: "reply",
      externalId: "comment-303",
      targetKind: "comment",
      targetId: "302",
      targetAuthor: { id: "9005", handle: "erin" },
      threadKind: "note",
      threadRootId: "301",
    })
  })

  test("does not create self-interactions", () => {
    const items = normalizeOutboundProfileFeed([
      {
        context: { type: "note_like", source: "db-like" },
        comment: { id: 401, type: "feed", user_id: Number(ownerId), handle: "owner" },
      },
    ], ownerId)

    expect(items).toEqual([])
  })
})

describe("owned post history", () => {
  test("advances past a historical post whose detail endpoint returns 404", async () => {
    const queries: string[] = []
    const client: any = {
      query: async (sql: string) => {
        queries.push(sql)
        return { rows: [] }
      },
    }
    const sdk: any = {
      getProfilePosts: async (_id: string, options: unknown) => {
        expect(options).toEqual({ limit: 1, offset: 3 })
        return { posts: [{ id: 777, title: "Unavailable historical post" }] }
      },
      getPostWithEngagement: async () => {
        const error: any = new Error("Substack request failed with 404.")
        error.status = 404
        throw error
      },
    }

    const result = await syncOwnedPostsPage(client, sdk, {
      userId: "user-1",
      connectionId: "connection-1",
      ownerId,
      ownerHandle: "owner",
      source: "import",
    }, "3", 1)

    expect(result).toMatchObject({ items: 1, nextCursor: "4", complete: false })
    expect(queries.some((sql) => sql.includes("insert into owned_content"))).toBe(true)
    expect(queries.some((sql) => sql.includes("insert into thread_snapshots"))).toBe(false)
  })
})
