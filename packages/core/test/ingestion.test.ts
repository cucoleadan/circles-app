import { describe, expect, test } from "bun:test"
import { createSubstackClient } from "../src/substack.js"
import {
  ingestActivityBatch,
  ingestConversationReplies,
  normalizeActivityPage,
  type ActivityItemInput,
  type ConversationInput,
} from "../src/ingestion.js"

describe("Substack client factory", () => {
  test("throws when session token is missing or empty", () => {
    expect(() => createSubstackClient({ sessionToken: "" })).toThrow(
      "Substack session token is required"
    )
    expect(() => createSubstackClient({ sessionToken: "   " })).toThrow(
      "Substack session token is required"
    )
  })

  test("instantiates SubstackClient with valid token", () => {
    const client = createSubstackClient({
      sessionToken: "valid-token",
      publicationUrl: "https://my.substack.com",
    })
    expect(client).toBeDefined()
  })
})

describe("In-memory mock ingestion unit tests", () => {
  test("normalizes activity lookup arrays and expands individual senders", () => {
    const items = normalizeActivityPage({
      activityItems: [{
        id: "activity-1",
        type: "reaction",
        recent_sender_ids: ["10", "11"],
        target_comment_id: "99",
        updated_at: "2026-09-17T12:00:00Z",
      }],
      users: [
        { id: 10, name: "Alice", handle: "alice" },
        { id: 11, user: { id: 11, name: "Bob", handle: "bob" } },
      ],
      comments: [{ id: 99, body: "Owned note", user: { id: 1, handle: "owner" } }],
      posts: [],
    })

    expect(items).toHaveLength(2)
    expect(items.map((item) => item.actor?.handle)).toEqual(["alice", "bob"])
    expect(items.map((item) => item.externalId)).toEqual([
      "activity-1:sender:10",
      "activity-1:sender:11",
    ])
    expect(items[0]?.targetAuthor?.handle).toBe("owner")
    expect(items[0]?.created_at).toBe("2026-09-17T12:00:00Z")
  })

  function createMockClient() {
    const people = new Map<string, any>()
    const interactions: any[] = []
    const relationshipStats = new Map<string, any>()

    const client: any = {
      query: async (sql: string, params: any[] = []) => {
        const lower = sql.toLowerCase()

        if (lower.includes("select count(*)::int as count from people")) {
          const userId = params[0]
          const count = Array.from(people.values()).filter((p) => p.user_id === userId).length
          return { rows: [{ count }] }
        }

        if (lower.includes("select id from people where user_id = $1 and normalized_handle = $2")) {
          const [userId, normalized] = params
          const found = Array.from(people.values()).find(
            (p) => p.user_id === userId && p.normalized_handle === normalized && !p.archived_at
          )
          return { rows: found ? [{ id: found.id }] : [] }
        }

        if (lower.includes("insert into people")) {
          const [id, userId, name, handle, normalized, profileUrl, substackProfileId] = params
          people.set(id, {
            id,
            user_id: userId,
            name,
            handle,
            normalized_handle: normalized,
            profile_url: profileUrl,
            substack_profile_id: substackProfileId,
          })
          return { rows: [] }
        }

        if (lower.includes("insert into interactions")) {
          const [
            id,
            userId,
            connectionId,
            personId,
            externalId,
            source,
            direction,
            actionType,
            targetType,
            targetId,
            targetTitle,
            targetUrl,
            threadKind,
            threadRootId,
            body,
            occurredAt,
            metadata,
          ] = params

          const exists = interactions.some(
            (i) => i.user_id === userId && i.external_id === externalId
          )
          if (!exists) {
            const row = {
              id,
              user_id: userId,
              connection_id: connectionId,
              person_id: personId,
              external_id: externalId,
              source,
              direction,
              action_type: actionType,
              target_type: targetType,
              target_id: targetId,
              target_title: targetTitle,
              target_url: targetUrl,
              thread_kind: threadKind,
              thread_root_id: threadRootId,
              body,
              occurred_at: occurredAt,
              metadata,
            }
            interactions.push(row)
            return { rows: [{ id }] }
          }
          return { rows: [] }
        }

        if (lower.includes("insert into relationship_stats")) {
          const personId = params[0]
          const personInteractions = interactions.filter((i) => i.person_id === personId)

          let engagementScore = 0
          for (const i of personInteractions) {
            if (i.action_type === "like") engagementScore += 1
            else if (i.action_type === "restack" && (!i.body || i.body.trim() === "")) engagementScore += 2
            else if (i.action_type === "restack") engagementScore += 3
            else if (i.action_type === "comment" || i.action_type === "reply") engagementScore += 3
            else engagementScore += 1
          }

          relationshipStats.set(personId, {
            person_id: personId,
            interaction_count: personInteractions.length,
            engagement_score: engagementScore,
          })
          return { rows: [] }
        }

        return { rows: [] }
      },
    }

    return { client, people, interactions, relationshipStats }
  }

  test("ingests batch and calculates engagement scores: like=1, restack=2, comment=3, restack with note=3", async () => {
    const { client, people, interactions, relationshipStats } = createMockClient()

    const items: ActivityItemInput[] = [
      {
        id: "act-1",
        kind: "like",
        createdAt: "2026-09-17T10:00:00Z",
        actor: { handle: "@alice", name: "Alice", id: 101 },
      },
      {
        id: "act-2",
        kind: "restack",
        comment_body: "", // restack without comment
        createdAt: "2026-09-17T10:05:00Z",
        actor: { handle: "alice", name: "Alice", id: 101 },
      },
      {
        id: "act-3",
        kind: "comment",
        comment_body: "Great post!",
        createdAt: "2026-09-17T10:10:00Z",
        actor: { handle: "alice", name: "Alice", id: 101 },
      },
      {
        id: "act-4",
        kind: "restack",
        comment_body: "Must read this!", // restack with note
        createdAt: "2026-09-17T10:15:00Z",
        actor: { handle: "alice", name: "Alice", id: 101 },
      },
    ]

    const stats = await ingestActivityBatch(client, {
      userId: "user-1",
      connectionId: "conn-1",
      ownerHandle: "owner",
      items,
      source: "sdk",
    })

    expect(stats.processedItems).toBe(4)
    expect(stats.newInteractions).toBe(4)
    expect(stats.newPeople).toBe(1)
    expect(people.size).toBe(1)

    const person = Array.from(people.values())[0]
    expect(person.normalized_handle).toBe("alice")

    const rel = relationshipStats.get(person.id)
    expect(rel).toBeDefined()
    expect(rel.interaction_count).toBe(4)
    // 1 (like) + 2 (restack plain) + 3 (comment) + 3 (restack with note) = 9
    expect(rel.engagement_score).toBe(9)
  })

  test("deduplicates identical items on repeated ingestion", async () => {
    const { client, interactions } = createMockClient()

    const items: ActivityItemInput[] = [
      {
        id: "dup-1",
        kind: "like",
        createdAt: "2026-09-17T10:00:00Z",
        actor: { handle: "bob", name: "Bob", id: 102 },
      },
    ]

    const first = await ingestActivityBatch(client, {
      userId: "user-1",
      items,
    })
    expect(first.newInteractions).toBe(1)

    const second = await ingestActivityBatch(client, {
      userId: "user-1",
      items,
    })
    expect(second.newInteractions).toBe(0)
    expect(interactions.length).toBe(1)
  })

  test("ingests nested conversation comments and preserves hierarchy", async () => {
    const { client, interactions, people } = createMockClient()

    const conversation: ConversationInput = {
      targetType: "note",
      targetId: "root-note-99",
      comments: [
        {
          id: "c-1",
          body: "Top level note reply",
          author_handle: "charlie",
          author_name: "Charlie",
          created_at: "2026-09-17T11:00:00Z",
          children: [
            {
              id: "c-2",
              body: "Nested reply to Charlie",
              author_handle: "owner",
              author_name: "Owner",
              created_at: "2026-09-17T11:05:00Z",
            },
          ],
        },
      ],
    }

    const stats = await ingestConversationReplies(client, {
      userId: "user-1",
      ownerHandle: "owner",
      conversation,
    })

    expect(stats.processedItems).toBe(2)
    expect(stats.newInteractions).toBe(2)
    // Owner is not added as a contact person
    expect(people.size).toBe(1)

    const charlieInteraction = interactions.find((i) => i.external_id === "comment-c-1")
    expect(charlieInteraction.direction).toBe("inbound")
    expect(charlieInteraction.action_type).toBe("comment")

    const ownerInteraction = interactions.find((i) => i.external_id === "comment-c-2")
    expect(ownerInteraction.direction).toBe("outbound")
    expect(ownerInteraction.action_type).toBe("reply")
    expect(ownerInteraction.person_id).toBe(charlieInteraction.person_id)
  })

  test("attributes an outbound action to its target author", async () => {
    const { client, interactions, people } = createMockClient()
    const stats = await ingestActivityBatch(client, {
      userId: "user-1",
      connectionId: "conn-1",
      ownerHandle: "owner",
      items: [{
        kind: "outbound-action",
        action: "like",
        externalId: "outbound:like:note:123",
        active: true,
        occurredAt: "2026-09-17T12:00:00Z",
        actor: { id: "owner-id", handle: "owner" },
        targetKind: "note",
        targetId: "123",
        targetAuthor: { id: "target-id", handle: "dana", name: "Dana" },
      }],
    })

    expect(stats.newInteractions).toBe(1)
    expect(people.size).toBe(1)
    expect(interactions[0].direction).toBe("outbound")
    expect(interactions[0].person_id).toBe(Array.from(people.values())[0].id)
  })
})
