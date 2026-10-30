import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { Pool } from "pg"

import { bootstrapRoles } from "../src/bootstrap-roles.js"
import { runMigrations } from "../src/migrate-runner.js"
import {
  testAdminUrl,
  testAppUrl,
  testDatabaseName,
  testMigrateUrl,
} from "./test-env.js"
import { db } from "../src/db.js"
import {
  addListMember,
  archivePerson,
  attachTag,
  createList,
  createPerson,
  createTag,
  getOrCreateAppUser,
  listLists,
  listPeople,
  personInteractions,
  recordInteraction,
  refreshPersonStats,
  getPerson,
  circlesOverview,
} from "../src/db/repositories.js"
import { withTenant } from "../src/db/tenant.js"
import { listComments, setCommentNotInterested } from "../src/db/comments.js"
import {
  applyFollowingSnapshot,
  ensurePerson,
  ingestActivityBatch,
  ingestConversationReplies,
  upsertSubscribersBatch,
  reconcileSubscriberSnapshot,
} from "@workspace/core"
import { ext } from "../src/routes/ext.js"
import { v1 } from "../src/routes/v1.js"
import { sniffImageType } from "../src/routes/v1/notes.js"
import type { InteractionInput } from "../src/db/repositories.js"
import { auth, mcpResource } from "../src/auth.js"
import { handleMcpRequest, mcpRoutes, principalFor } from "../src/mcp/server.js"
import { Hono } from "hono"
import { mcpBrowserRoutes } from "../src/mcp/browser.js"
import { enqueueSdkTool, getSdkRun, type McpPrincipal } from "../src/mcp/sdk-tools.js"
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { auth as clientAuth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto"
import { oauthProtocolRoutes } from "../src/mcp/oauth-http.js"
import { circlesTools } from "../src/mcp/circles-tools.js"
import { MCP_SCOPES } from "../src/mcp/scopes.js"

let admin: Pool
let migrate: Pool

const authA = "auth-user-a"
const authB = "auth-user-b"
let userA = ""
let userB = ""

beforeAll(async () => {
  admin = new Pool({ connectionString: testAdminUrl, max: 1 })
  const bootstrap = new URL(testAdminUrl)
  bootstrap.pathname = "/postgres"
  const creator = new Pool({ connectionString: bootstrap.toString(), max: 1 })
  await creator.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${testDatabaseName}'`
  )
  await creator.query(`drop database if exists ${testDatabaseName}`)
  await creator.query(`create database ${testDatabaseName}`)
  await creator.end()

  // Schema ACLs and default privileges are per-database, so the fresh test
  // database needs its own role bootstrap before migrations can run.
  const ownerUrl = new URL(testAdminUrl)
  ownerUrl.pathname = `/${testDatabaseName}`
  const owner = new Pool({ connectionString: ownerUrl.toString(), max: 1 })
  await bootstrapRoles(owner, {
    app: process.env.APP_DB_PASSWORD!,
    migrate: process.env.MIGRATE_DB_PASSWORD!,
  })
  await owner.end()

  migrate = new Pool({ connectionString: testMigrateUrl, max: 1 })
  await runMigrations(migrate)

  await migrate.query(
    `insert into "user" (id, name, email, "emailVerified") values
       ($1, 'Test A', 'a@test.local', true),
       ($2, 'Test B', 'b@test.local', true)`,
    [authA, authB]
  )
  await migrate.query(
    `insert into app_users (id, auth_user_id) values
       ('tenant-a', $1), ('tenant-b', $2)`,
    [authA, authB]
  )
  userA = "tenant-a"
  userB = "tenant-b"
}, 60_000)

afterAll(async () => {
  await db.end()
  await migrate.end()
  await admin.end()
  const bootstrap = new URL(testAdminUrl)
  bootstrap.pathname = "/postgres"
  const dropper = new Pool({ connectionString: bootstrap.toString(), max: 1 })
  await dropper.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${testDatabaseName}'`
  )
  await dropper.query(`drop database if exists ${testDatabaseName}`)
  await dropper.end()
})

beforeEach(async () => {
  await migrate.query(`truncate table
    people, relationship_stats, tags, person_tags, lists, list_members,
    saved_views, interactions, substack_connections, profile_snapshots,
    thread_snapshots, activity_snapshots, note_replies_snapshots, sync_state,
    import_runs, ingestion_batches, audit_log, jobs, note_tags
    restart identity cascade`)
})


/** Answers the Substack SDK's authenticated-profile lookup without network access. */
async function withStubbedSubstackProfile<T>(fn: () => T | Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/handle/options")) {
      return Response.json({ potentialHandles: [{ type: "existing", handle: "tester" }] })
    }
    if (url.includes("/public_profile")) {
      return Response.json({ id: 4242, name: "Tester", handle: "tester" })
    }
    return new Response("unexpected request in test", { status: 500 })
  }) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe("tenant isolation", () => {
  test("each tenant only sees its own people", async () => {
    await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )

    const seenByA = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client)
    )
    const seenByB = await withTenant({ appUserId: userB }, (client) =>
      listPeople(client)
    )
    expect(seenByA.map((p) => p.name)).toEqual(["Alice"])
    expect(seenByB).toEqual([])
  })

  test("the runtime role without tenant context sees nothing", async () => {
    await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )
    const result = await db.query("select count(*)::int as count from people")
    expect(result.rows[0].count).toBe(0)
  })

  test("auth session resolves to one stable app user", async () => {
    const first = await getOrCreateAppUser(authA)
    const second = await getOrCreateAppUser(authA)
    expect(first).toBe(second)
    const other = await getOrCreateAppUser(authB)
    expect(other).not.toBe(first)
  })

  test("cross-tenant membership edges are rejected by the database", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )
    const tag = await withTenant({ appUserId: userB }, (client) =>
      createTag(client, userB, "vip")
    )

    let err: any
    try {
      await withTenant({ appUserId: userB }, (client) =>
        attachTag(client, userB, tag.id, person.id)
      )
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(err?.code).toBe("23503")
  })
})

describe("transactional edits", () => {
  test("create list and add member commit atomically", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )

    const list = await withTenant({ appUserId: userA }, async (client) => {
      const created = await createList(client, userA, "Inner circle")
      await addListMember(client, userA, created.id, person.id)
      return created
    })

    const lists = await withTenant({ appUserId: userA }, (client) =>
      listLists(client)
    )
    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({ id: list.id, name: "Inner circle", count: 1 })

    const personDetail = await withTenant({ appUserId: userA }, (client) =>
      getPerson(client, person.id)
    )
    expect(personDetail?.lists[0]).toMatchObject({ id: list.id, name: "Inner circle" })
    expect(personDetail?.lists[0]?.createdAt).toBeTruthy()

    const peopleList = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { listId: list.id })
    )
    expect(peopleList[0]?.lists?.[0]).toMatchObject({ id: list.id, name: "Inner circle" })
    expect(peopleList[0]?.lists?.[0]?.createdAt).toBeTruthy()
  })

  test("list counts match visible members after archiving or ignoring contacts", async () => {
    const [visible, archived, ignored] = await withTenant({ appUserId: userA }, async (client) => [
      await createPerson(client, userA, { name: "Visible", handle: "visible" }),
      await createPerson(client, userA, { name: "Archived", handle: "archived" }),
      await createPerson(client, userA, { name: "Ignored", handle: "ignored" }),
    ])
    const [list, ignoredList] = await withTenant({ appUserId: userA }, async (client) => {
      const created = await createList(client, userA, "BIG FISH")
      const hidden = await createList(client, userA, "Ignored")
      for (const person of [visible, archived, ignored]) {
        await addListMember(client, userA, created.id, person.id)
      }
      await addListMember(client, userA, hidden.id, ignored.id)
      await archivePerson(client, archived.id)
      return [created, hidden]
    })

    const lists = await withTenant({ appUserId: userA }, (client) => listLists(client))
    expect(lists.find((item) => item.id === list.id)?.count).toBe(1)
    expect(lists.find((item) => item.id === ignoredList.id)?.count).toBe(1)

    const people = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { listId: list.id })
    )
    expect(people.map((person) => person.id)).toEqual([visible.id])
    const ignoredPeople = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { listId: ignoredList.id })
    )
    expect(ignoredPeople.map((person) => person.id)).toEqual([ignored.id])
  })

  test("a failed membership insert rolls back the whole edit", async () => {
    await expect(
      withTenant({ appUserId: userA }, async (client) => {
        const created = await createList(client, userA, "Broken circle")
        await addListMember(client, userA, created.id, "no-such-person")
      })
    ).rejects.toMatchObject({ code: "23503" })

    const lists = await withTenant({ appUserId: userA }, (client) =>
      listLists(client)
    )
    expect(lists).toEqual([])
  })

  test("handle uniqueness applies after normalization", async () => {
    await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@Alice" })
    )
    let err: any
    try {
      await withTenant({ appUserId: userA }, (client) =>
        createPerson(client, userA, { name: "Alice 2", handle: "alice" })
      )
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(err?.code).toBe("23505")
  })

  test("archiving hides a person and frees its handle", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Bob", handle: "@bob" })
    )
    await withTenant({ appUserId: userA }, (client) =>
      archivePerson(client, person.id)
    )

    const active = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client)
    )
    expect(active).toEqual([])

    const recreated = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Bob 2", handle: "bob" })
    )
    expect(recreated.handle).toBe("bob")
  })
})

describe("interactions", () => {
  test("comment response exclusion applies before pagination and links open the owned content", async () => {
    const recentBase = Date.now() - 60 * 60 * 1000
    const oldTime = recentBase - 72 * 60 * 60 * 1000
    await migrate.query(
      `insert into substack_connections
         (id, user_id, envelope_version, key_id, wrapped_key, iv, ciphertext, profile_handle)
       values ('comments-connection', $1, 1, 'test', 'test', 'test', 'test', 'tester')`,
      [userA],
    )
    await migrate.query(
      `insert into owned_content (id, user_id, connection_id, kind, external_id, title, url)
       values ('owned-note', $1, 'comments-connection', 'note', '900', null, null),
              ('owned-post', $1, 'comments-connection', 'post', '901', 'Article', 'https://tester.substack.com/p/article')`,
      [userA],
    )
    await withTenant({ appUserId: userA }, async (client) => {
      const person = await createPerson(client, userA, { name: "Commenter", handle: "commenter" })
      const add = (input: Partial<InteractionInput> & Pick<InteractionInput, "externalId">) =>
        recordInteraction(client, userA, {
          personId: person.id, connectionId: "comments-connection", direction: "inbound",
          actionType: "comment", targetType: "note", targetId: "900",
          threadKind: "note", threadRootId: "900", occurredAt: new Date(recentBase).toISOString(),
          ...input,
        })
      for (const [index, id] of ["liked", "replied", "both", "dismissed", "new", "unliked"].entries()) {
        await add({ externalId: `comment-${id}`, body: id, occurredAt: new Date(recentBase + index * 60 * 1000).toISOString(),
          ...(id === "replied" ? { targetType: "post", targetId: "901", threadKind: "post", threadRootId: "901" } : {}),
        })
      }
      await add({ externalId: "feed-new", metadata: { commentId: "new", rootCommentId: "900" }, body: "new" })
      await add({ externalId: "comment-old", occurredAt: new Date(oldTime).toISOString() })
      await add({ externalId: "comment-old-end", occurredAt: new Date(oldTime + 1).toISOString() })
      await add({ externalId: "comment-future", occurredAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
      for (const id of ["liked", "both", "unliked"]) {
        const like = await add({ externalId: `like-${id}`, direction: "outbound", actionType: "like", targetType: "comment", targetId: id })
        if (id === "unliked") await client.query("update interactions set removed_at = now() where id = $1", [like!.id])
      }
      for (const id of ["replied", "both"]) {
        await add({ externalId: `reply-${id}`, direction: "outbound", actionType: "reply", targetType: "comment", targetId: id })
      }
      // Liking a Note does not acknowledge an individual comment on that Note.
      await add({ externalId: "like-note", direction: "outbound", actionType: "like" })
      const all = await listComments(client)
      expect(all.comments).toHaveLength(6)
      const historical = await listComments(client, {
        since: new Date(oldTime).toISOString(), until: new Date(oldTime + 1).toISOString(),
      })
      expect(historical.comments.map((item) => item.commentId)).toEqual(["old"])
      const note = all.comments.find((item) => item.commentId === "new")!
      const article = all.comments.find((item) => item.commentId === "replied")!
      expect(note.contentUrl).toBe("https://substack.com/@tester/note/c-900")
      expect(article.contentUrl).toBe("https://tester.substack.com/p/article")
      expect(await setCommentNotInterested(client, all.comments.find((item) => item.commentId === "dismissed")!.id, true)).toBe(true)
      const remaining = await listComments(client, { excludeResponded: true })
      expect(remaining.comments.map((item) => item.commentId)).toEqual(["unliked", "new", "dismissed"])
      expect(remaining.comments.every((item) => !item.liked && !item.replied)).toBe(true)
      expect((await listComments(client, { excludeResponded: true, status: "pending" })).comments.map((item) => item.commentId)).toEqual(["unliked", "new"])
      const first = await listComments(client, { excludeResponded: true, limit: 1 })
      const second = await listComments(client, { excludeResponded: true, limit: 1, cursor: first.nextCursor! })
      expect(first.comments.map((item) => item.commentId)).toEqual(["unliked"])
      expect(second.comments.map((item) => item.commentId)).toEqual(["new"])
      expect(await setCommentNotInterested(client, note.id, true)).toBe(true)
      const duplicateChoices = await client.query("select not_interested from interactions where external_id in ('comment-new', 'feed-new')")
      expect(duplicateChoices.rows.every((item) => item.not_interested)).toBe(true)
    })
    expect((await withTenant({ appUserId: userB }, (client) => listComments(client, { excludeResponded: true }))).comments).toEqual([])
    const request = (query: string) => v1.fetch(new Request(`http://localhost:3000/comments?${query}`, { headers: { cookie: signedCookieA } }))
    const filtered = await request("excludeResponded=true")
    expect(filtered.status).toBe(200)
    expect((await filtered.json() as any).comments).toHaveLength(3)
    expect((await (await request("excludeResponded=false")).json() as any).comments).toHaveLength(6)
    expect((await request("excludeResponded=invalid")).status).toBe(400)
    const historicalQuery = new URLSearchParams({ since: new Date(oldTime).toISOString(), until: new Date(oldTime + 1).toISOString() })
    expect((await (await request(historicalQuery.toString())).json() as any).comments.map((item: any) => item.commentId)).toEqual(["old"])
    expect((await request("since=invalid&until=invalid")).status).toBe(400)
    expect((await request("since=2026-10-12T00:00:00Z")).status).toBe(400)
    expect((await request("since=2026-10-13T00:00:00Z&until=2026-10-12T00:00:00Z")).status).toBe(400)
  })

  test("contact refetch queues one non-retrying job and scopes status to its owner", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Refetch Person", handle: "refetch-person" })
    )
    await migrate.query(
      `insert into substack_connections
         (id, user_id, envelope_version, key_id, wrapped_key, iv, ciphertext)
       values ('refetch-connection', $1, 1, 'test', 'test', 'test', 'test')`,
      [userA],
    )
    const url = `http://localhost:3000/people/${person.id}/refetch`
    const first = await v1.fetch(new Request(url, { method: "POST", headers: { cookie: signedCookieA } }))
    expect(first.status).toBe(202)
    const { jobId } = (await first.json()) as { jobId: string }
    const duplicate = await v1.fetch(new Request(url, { method: "POST", headers: { cookie: signedCookieA } }))
    expect((await duplicate.json() as any).jobId).toBe(jobId)
    const job = (await migrate.query("select max_attempts from jobs where id = $1", [jobId])).rows[0]
    expect(job.max_attempts).toBe(1)
    const statusUrl = `${url}/${jobId}`
    expect((await v1.fetch(new Request(statusUrl, { headers: { cookie: signedCookieA } }))).status).toBe(200)
    expect((await v1.fetch(new Request(statusUrl, { headers: { cookie: signedCookieB } }))).status).toBe(404)
    await migrate.query("update jobs set status = 'dead' where id = $1", [jobId])
    expect((await v1.fetch(new Request(url, { method: "POST", headers: { cookie: signedCookieA } }))).status).toBe(429)
  })
  test("dedupe by external id and cursor pagination stay consistent", async () => {
    // Drift is derived from the last interaction at read time, so keep it recent.
    const recentBase = Date.now() - 2 * 24 * 60 * 60 * 1000
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )

    await withTenant({ appUserId: userA }, async (client) => {
      const first = await recordInteraction(client, userA, {
        externalId: "evt-0",
        personId: person.id,
        direction: "inbound",
        actionType: "comment",
        occurredAt: new Date(recentBase).toISOString(),
      })
      expect(first).not.toBeNull()

      const duplicate = await recordInteraction(client, userA, {
        externalId: "evt-0",
        personId: person.id,
        direction: "inbound",
        actionType: "comment",
        occurredAt: new Date(recentBase).toISOString(),
      })
      expect(duplicate).toBeNull()

      for (let i = 1; i <= 24; i++) {
        await recordInteraction(client, userA, {
          externalId: `evt-${i}`,
          personId: person.id,
          direction: i % 2 ? "inbound" : "outbound",
          actionType: "reply",
          threadKind: "note",
          threadRootId: "note-1",
          occurredAt: new Date(
            recentBase + i * 60_000
          ).toISOString(),
        })
      }
      await refreshPersonStats(client, person.id)
    })

    const detail = await withTenant({ appUserId: userA }, (client) =>
      getPerson(client, person.id)
    )
    expect(detail?.person.interactionCount).toBe(25)
    expect(detail?.person.conversationCount).toBe(1)
    expect(detail?.person.driftStatus).toBe("active")

    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await withTenant({ appUserId: userA }, (client) =>
        personInteractions(client, person.id, { cursor, limit: 10 })
      )
      seen.push(...page.interactions.map((i) => i.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
  })

  test("other tenants cannot read a person's timeline", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )
    await withTenant({ appUserId: userA }, (client) =>
      recordInteraction(client, userA, {
        externalId: "evt-1",
        personId: person.id,
        direction: "inbound",
        actionType: "comment",
        occurredAt: new Date().toISOString(),
      })
    )

    const foreign = await withTenant({ appUserId: userB }, (client) =>
      personInteractions(client, person.id)
    )
    expect(foreign.interactions).toEqual([])

    const notFound = await withTenant({ appUserId: userB }, (client) =>
      getPerson(client, person.id)
    )
    expect(notFound).toBeNull()
  })

  test("replaying a soft-removed duplicate like never collides with the active like", async () => {
    const like = (id: string) => ({
      id,
      kind: "like",
      actor: { id: 777, name: "Dupe", handle: "@dupe" },
      target_kind: "note",
      target_id: "note-dup-1",
      created_at: new Date().toISOString(),
    })
    await withTenant({ appUserId: userA }, (client) =>
      ingestActivityBatch(client, { userId: userA, ownerHandle: "myhandle", items: [like("like-old")] })
    )
    // Mirror migration 011: the older duplicate was soft-removed and a newer
    // capture of the same Like became the active row.
    await withTenant({ appUserId: userA }, async (client) => {
      await client.query("update interactions set removed_at = now() where external_id = 'like-old'")
      await ingestActivityBatch(client, { userId: userA, ownerHandle: "myhandle", items: [like("like-new")] })
    })

    // Replaying the retained batch that contained the removed duplicate.
    await withTenant({ appUserId: userA }, (client) =>
      ingestActivityBatch(client, { userId: userA, ownerHandle: "myhandle", items: [like("like-old")] })
    )

    const rows = await withTenant({ appUserId: userA }, (client) =>
      client.query(
        "select external_id, removed_at is null as active from interactions where target_id = 'note-dup-1' order by external_id"
      )
    )
    expect(rows.rows).toEqual([
      { external_id: "like-new", active: true },
      { external_id: "like-old", active: false },
    ])
  })

  test("ingests activity items and calculates engagement score accurately (1/2/3/3)", async () => {
    const stats = await withTenant({ appUserId: userA }, (client) =>
      ingestActivityBatch(client, {
        userId: userA,
        ownerHandle: "myhandle",
        items: [
          {
            id: "act-1",
            kind: "like",
            actor: { name: "Bob", handle: "@bob" },
            target_kind: "post",
            created_at: new Date().toISOString(),
          },
          {
            id: "act-2",
            kind: "restack",
            actor: { name: "Bob", handle: "@bob" },
            target_kind: "note",
            comment_body: null, // restack without comment = 2
            created_at: new Date().toISOString(),
          },
          {
            id: "act-3",
            kind: "comment",
            actor: { name: "Bob", handle: "@bob" },
            target_kind: "post",
            comment_body: "Great post!", // comment = 3
            created_at: new Date().toISOString(),
          },
          {
            id: "act-4",
            kind: "restack",
            actor: { name: "Bob", handle: "@bob" },
            target_kind: "note",
            comment_body: "Thoughtful note attached", // restack with note = 3
            created_at: new Date().toISOString(),
          },
        ],
      })
    )

    expect(stats.processedItems).toBe(4)
    expect(stats.newInteractions).toBe(4)
    expect(stats.newPeople).toBe(1)

    // Check Bob's person stats
    const people = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "bob" })
    )
    expect(people).toHaveLength(1)
    const bob = people[0]
    expect(bob.name).toBe("Bob")
    expect(bob.handle).toBe("bob")
    expect(bob.interactionCount).toBe(4)
    // 1 (like) + 2 (restack) + 3 (comment) + 3 (restack with note) = 9
    expect(bob.engagementScore).toBe(9)

    // Replaying the exact same batch should not duplicate interactions or falsely increase scores
    const replayStats = await withTenant({ appUserId: userA }, (client) =>
      ingestActivityBatch(client, {
        userId: userA,
        ownerHandle: "myhandle",
        items: [
          {
            id: "act-1",
            kind: "like",
            actor: { name: "Bob", handle: "@bob" },
            target_kind: "post",
            created_at: new Date().toISOString(),
          },
          {
            id: "act-2",
            kind: "restack",
            actor: { name: "Bob", handle: "@bob" },
            target_kind: "note",
            comment_body: null,
            created_at: new Date().toISOString(),
          },
        ],
      })
    )
    expect(replayStats.newInteractions).toBe(0)
    expect(replayStats.newPeople).toBe(0)

    const recheck = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "bob" })
    )
    expect(recheck[0].engagementScore).toBe(9)
    expect(recheck[0].interactionCount).toBe(4)
  })

  test("ingests conversation replies tree and updates thread counts", async () => {
    const stats = await withTenant({ appUserId: userA }, (client) =>
      ingestConversationReplies(client, {
        userId: userA,
        ownerHandle: "myhandle",
        conversation: {
          targetType: "note",
          targetId: "note-root-123",
          comments: [
            {
              id: "c-1",
              author_name: "Carol",
              author_handle: "@carol",
              body: "First comment",
              children: [
                {
                  id: "c-2",
                  author_name: "Owner",
                  author_handle: "@myhandle", // outbound reply
                  body: "Thanks Carol!",
                },
                {
                  id: "c-3",
                  author_name: "Carol",
                  author_handle: "@carol",
                  body: "You're welcome!",
                },
              ],
            },
          ],
        },
      })
    )

    expect(stats.processedItems).toBe(3)
    expect(stats.newInteractions).toBe(2)

    const people = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "carol" })
    )
    expect(people).toHaveLength(1)
    const carol = people[0]
    expect(carol.interactionCount).toBe(2) // Carol's direct comment + owner's reply to Carol
    expect(carol.conversationCount).toBe(1) // 1 thread root
    expect(carol.engagementScore).toBe(3) // inbound engagement only; outbound is tracked separately
    expect(carol.inboundInteractionCount).toBe(1)
    expect(carol.outboundInteractionCount).toBe(1)
  })

  let signedCookieA = ""
  let signedCookieB = ""

  beforeAll(async () => {
    const { makeSignature } = await import("better-auth/crypto")
    const token = "test-token-a"
    const sig = await makeSignature(token, process.env.BETTER_AUTH_SECRET!)
    signedCookieA = `better-auth.session_token=${encodeURIComponent(token)}.${sig}`
    const tokenB = "test-token-b"
    const sigB = await makeSignature(tokenB, process.env.BETTER_AUTH_SECRET!)
    signedCookieB = `better-auth.session_token=${encodeURIComponent(tokenB)}.${sigB}`

    await migrate.query(
      `insert into session (id, "userId", token, "expiresAt", "createdAt", "updatedAt") values
         ('sess-a', $1, $2, now() + interval '1 day', now(), now())
       on conflict (id) do nothing`,
      [authA, token]
    )
    await migrate.query(
      `insert into session (id, "userId", token, "expiresAt", "createdAt", "updatedAt") values
         ('sess-b', $1, $2, now() + interval '1 day', now(), now())
       on conflict (id) do nothing`,
      [authB, tokenB]
    )
  })

  test("GET /companion returns lists and handles for connected user", async () => {
    const list = await withTenant({ appUserId: userA }, (client) =>
      createList(client, userA, "VIPs")
    )
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "David", handle: "@david" })
    )
    await withTenant({ appUserId: userA }, (client) =>
      addListMember(client, userA, list.id, person.id)
    )

    const res = await ext.fetch(
      new Request("http://localhost:3000/companion", {
        headers: {
          cookie: signedCookieA,
        },
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.appState.lists).toContainEqual(expect.objectContaining({ name: "VIPs" }))
    expect(body.appState.handles).toContain("david")
    expect(body.appState.members).toContainEqual(
      expect.objectContaining({
        handle: "david",
        lists: expect.arrayContaining([expect.objectContaining({ name: "VIPs" })]),
      })
    )
  })

  test("POST /activity ingests passively captured batch from extension", async () => {
    const res = await ext.fetch(
      new Request("http://localhost:3000/activity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          activityItems: [
            {
              id: "ext-act-1",
              kind: "comment",
              actor: { name: "Eve", handle: "@eve" },
              target_kind: "post",
              comment_body: "Loving this extension!",
              created_at: new Date().toISOString(),
            },
          ],
        }),
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.captured).toBe(1)
    expect(body.newInteractions).toBe(1)
    expect(body.newPeople).toBe(1)

    const eve = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "eve" })
    )
    expect(eve).toHaveLength(1)
    expect(eve[0].engagementScore).toBe(3)
  })

  test("POST /browser-reads takes subscriber pages only in order and records each read", async () => {
    let connectionId = (await migrate.query(
      "select id from substack_connections where user_id = $1 and status = 'active'", [userA],
    )).rows[0]?.id
    if (!connectionId) {
      connectionId = "browser-reads-connection"
      await migrate.query(
        `insert into substack_connections (id, user_id, envelope_version, key_id, wrapped_key, iv, ciphertext)
         values ($1, $2, 1, 'test', 'test', 'test', 'test')`,
        [connectionId, userA],
      )
    }
    const read = async (body: Record<string, unknown>) => {
      const res = await ext.fetch(new Request("http://localhost:3000/browser-reads", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: signedCookieA },
        body: JSON.stringify({ connectionId, ...body }),
      }))
      return { status: res.status, body: await res.json() as any }
    }
    const runStartedAt = new Date(Date.now() - 1000).toISOString()
    const reader = { user_id: 77001, user_name: "Reader", user_email_address: "reader@example.com", subscription_created_at: runStartedAt }

    expect(await read({ kind: "following", payload: [] })).toMatchObject({ status: 200, body: { ok: true } })
    expect(await read({ kind: "activity" })).toMatchObject({ status: 200, body: { ok: true } })

    const first = await read({ kind: "subscribers", runStartedAt, offset: 0, payload: { subscribers: [reader], count: 300 } })
    expect(first).toMatchObject({ status: 200, body: { completed: false, nextOffset: 1, created: 1 } })
    // A skipped page would hide subscribers from the reconcile, so it restarts the sweep.
    expect(await read({ kind: "subscribers", runStartedAt, offset: 5, payload: { subscribers: [], count: 300 } }))
      .toMatchObject({ status: 409, body: { restart: true } })
    expect(await read({ kind: "subscribers", runStartedAt, offset: 1, payload: { subscribers: [], count: 300 } }))
      .toMatchObject({ status: 200, body: { completed: true } })
    // A sweep that saw nobody never marks anyone unsubscribed.
    expect(await read({ kind: "subscribers", runStartedAt: new Date().toISOString(), offset: 0, payload: { subscribers: [], count: 0 } }))
      .toMatchObject({ status: 200, body: { completed: true, deactivated: 0 } })

    const conn = (await migrate.query(
      `select browser_activity_at, browser_following_at, browser_subscribers_at, browser_subscriber_run
       from substack_connections where id = $1`, [connectionId],
    )).rows[0]
    expect(conn.browser_activity_at).not.toBeNull()
    expect(conn.browser_following_at).not.toBeNull()
    expect(conn.browser_subscribers_at).not.toBeNull()
    expect(conn.browser_subscriber_run).toBeNull()
    const subscriber = (await migrate.query(
      "select is_subscriber from people where user_id = $1 and substack_profile_id = '77001'", [userA],
    )).rows[0]
    expect(subscriber?.is_subscriber).toBe(true)

    expect(await read({ kind: "activity", connectionId: "not-this-account" })).toMatchObject({ status: 409, body: { rejected: true } })
  })

  test("POST /community adds person to CRM and lists from extension form", async () => {
    const list = await withTenant({ appUserId: userA }, (client) =>
      createList(client, userA, "Newsletter")
    )

    const form = new FormData()
    form.set("intent", "createPerson")
    form.set("name", "Frank")
    form.set("handle", "@frank")
    form.append("lists", list.id)

    const res = await ext.fetch(
      new Request("http://localhost:3000/community", {
        method: "POST",
        headers: {
          cookie: signedCookieA,
        },
        body: form,
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.submit.ok).toBe(true)

    const frank = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "frank", listId: list.id })
    )
    expect(frank).toHaveLength(1)
    expect(frank[0].handle).toBe("frank")
  })

  test("POST /person (JSON) adds person to CRM, lists and creates tags", async () => {
    const list = await withTenant({ appUserId: userA }, (client) =>
      createList(client, userA, "VIPs")
    )

    const res = await ext.fetch(
      new Request("http://localhost:3000/person", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          name: "Grace Hopper",
          handle: "@grace",
          lists: [list.id],
          tags: ["pioneer", "compiler"],
        }),
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)

    const grace = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "grace", listId: list.id })
    )
    expect(grace).toHaveLength(1)
    expect(grace[0].handle).toBe("grace")
  })

  test("POST /connect (JSON) connects Substack session and /install updates user", async () => {
    const connectRes = await withStubbedSubstackProfile(() => ext.fetch(
      new Request("http://localhost:3000/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          sessionToken: "test-extension-direct-json-session",
          publicationUrl: "https://testpub.substack.com",
        }),
      })
    ))
    expect(connectRes.status).toBe(200)
    const connectBody = (await connectRes.json()) as any
    expect(connectBody.ok).toBe(true)

    const installRes = await ext.fetch(
      new Request("http://localhost:3000/install", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({}),
      })
    )
    expect(installRes.status).toBe(200)
    const installBody = (await installRes.json()) as any
    expect(installBody.ok).toBe(true)
  })

  test("a session Substack rejects never replaces the working connection", async () => {
    const connect = (sessionToken: string) => ext.fetch(
      new Request("http://localhost:3000/connect", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: signedCookieA },
        body: JSON.stringify({ sessionToken }),
      })
    )
    expect((await withStubbedSubstackProfile(() => connect("working-session"))).status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      const rejected = await connect("stale-session")
      expect(rejected.status).toBe(400)
      const rejectedBody = (await rejected.json()) as any
      expect(rejectedBody.ok).toBe(false)
      expect(rejectedBody.message).toContain("Substack did not accept this session")
    } finally {
      globalThis.fetch = originalFetch
      console.warn = originalWarn
    }

    const active = await withTenant({ appUserId: userA }, (client) =>
      client.query("select ciphertext, profile_id from substack_connections where status = 'active'")
    )
    expect(active.rows).toHaveLength(1)
    expect(active.rows[0].ciphertext).toBe("working-session")
    expect(active.rows[0].profile_id).toBe("4242")
  })

  test("queue maintenance restarts a stranded scheduled sync", async () => {
    await withStubbedSubstackProfile(() => ext.fetch(
      new Request("http://localhost:3000/connect", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: signedCookieA },
        body: JSON.stringify({ sessionToken: "stranded-session" }),
      })
    ))
    // Simulate a chain that ended: no queued or running activity job remains.
    await migrate.query("update jobs set status = 'dead' where type = 'sync:activity' and status in ('pending', 'running')")

    const seeded = await withTenant({ appUserId: userA }, (client) =>
      client.query("select seed_missing_activity_syncs() as seeded")
    )
    expect(Number(seeded.rows[0].seeded)).toBeGreaterThanOrEqual(1)
    const again = await withTenant({ appUserId: userA }, (client) =>
      client.query("select seed_missing_activity_syncs() as seeded")
    )
    expect(Number(again.rows[0].seeded)).toBe(0)
  })

  test("connection, sync with cooldown, and import runs lifecycle via v1 API", async () => {
    // 1. POST /connection
    const connRes = await withStubbedSubstackProfile(() => v1.fetch(
      new Request("http://localhost:3000/connection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          sessionToken: "test-v1-session-cookie",
        }),
      })
    ))
    expect(connRes.status).toBe(201)
    const connBody = (await connRes.json()) as any
    expect(connBody.connection.id).toBeDefined()
    expect(connBody.connection.profileId).toBe("4242")

    // Connecting schedules the first sync so the recurring chain starts at once.
    const seeded = await withTenant({ appUserId: userA }, (client) =>
      client.query(
        "select id from jobs where type = 'sync:activity' and status = 'pending' and payload->>'connectionId' = $1",
        [connBody.connection.id],
      )
    )
    expect(seeded.rows).toHaveLength(1)
    await migrate.query("update jobs set status = 'done' where id = $1", [seeded.rows[0].id])

    // 2. GET /connection
    const getConnRes = await v1.fetch(
      new Request("http://localhost:3000/connection", {
        headers: { cookie: signedCookieA },
      })
    )
    expect(getConnRes.status).toBe(200)
    const getConnBody = (await getConnRes.json()) as any
    expect(getConnBody.connection.id).toBe(connBody.connection.id)

    // A future scheduled run must not prevent the manual Sync button from working.
    await withTenant({ appUserId: userA }, async (client) => {
      await client.query(
        `insert into jobs (type, payload, status, run_at)
         values ('sync:activity', $1, 'pending', now() + interval '3 hours')`,
        [JSON.stringify({ userId: userA, connectionId: connBody.connection.id })],
      )
    })

    // 3. POST /sync (first call: enqueued)
    const syncRes1 = await v1.fetch(
      new Request("http://localhost:3000/sync", {
        method: "POST",
        headers: { cookie: signedCookieA },
      })
    )
    expect(syncRes1.status).toBe(200)
    const syncBody1 = (await syncRes1.json()) as any
    expect(syncBody1.enqueued).toBe(true)
    expect(syncBody1.jobId).toBeDefined()

    const pendingProgress = await v1.fetch(new Request("http://localhost:3000/sync/progress", {
      headers: { cookie: signedCookieA },
    }))
    expect(pendingProgress.status).toBe(200)
    const pendingBody = (await pendingProgress.json()) as any
    expect(pendingBody.run.id).toBe(String(syncBody1.jobId))
    expect(pendingBody.run.status).toBe("running")
    expect(pendingBody.run.steps).toHaveLength(1)

    await withTenant({ appUserId: userA }, async (client) => {
      await client.query(
        `update jobs set status = 'done', result = '{"processedItems":12,"newInteractions":2,"newPeople":1}'::jsonb
         where id = $1`,
        [syncBody1.jobId],
      )
      await client.query(
        `insert into jobs (type, payload, status, run_at, last_error)
         values ('sync:history', $1, 'pending', now() + interval '10 seconds',
                 'private request detail that must stay on the server')`,
        [JSON.stringify({
          userId: userA,
          connectionId: connBody.connection.id,
          parentJobId: String(syncBody1.jobId),
          stream: "owned_notes",
        })],
      )
    })
    const progressRes = await v1.fetch(new Request("http://localhost:3000/sync/progress", {
      headers: { cookie: signedCookieA },
    }))
    expect(progressRes.status).toBe(200)
    const progressBody = (await progressRes.json()) as any
    expect(progressBody.run.steps).toHaveLength(2)
    expect(progressBody.run.steps[0].result.newInteractions).toBe(2)
    expect(progressBody.run.steps[1].stream).toBe("owned_notes")
    expect(JSON.stringify(progressBody)).not.toContain("private request detail")

    const otherTenantProgress = await v1.fetch(new Request("http://localhost:3000/sync/progress", {
      headers: { cookie: signedCookieB },
    }))
    expect((await otherTenantProgress.json() as any).run).toBeNull()

    // 4. Update sync_state last_synced_at to now() to test cooldown
    await withTenant({ appUserId: userA }, async (client) => {
      await client.query(
        "update sync_state set last_synced_at = now() where connection_id = $1",
        [connBody.connection.id]
      )
    })

    // 5. POST /sync (second call within cooldown: refused)
    const syncRes2 = await v1.fetch(
      new Request("http://localhost:3000/sync", {
        method: "POST",
        headers: { cookie: signedCookieA },
      })
    )
    expect(syncRes2.status).toBe(200)
    const syncBody2 = (await syncRes2.json()) as any
    expect(syncBody2.enqueued).toBe(false)
    expect(syncBody2.message).toContain("recently performed")

    // 6. POST /imports (start historical import run)
    const importRes = await v1.fetch(
      new Request("http://localhost:3000/imports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          months: 6,
          streams: [
            "activity", "outbound_actions", "owned_notes", "owned_posts",
            "subscribers", "following",
          ],
        }),
      })
    )
    expect(importRes.status).toBe(201)
    const importBody = (await importRes.json()) as any
    expect(importBody.enqueued).toBe(true)
    expect(importBody.importRunId).toBeDefined()

    // 7. GET /imports (list imports)
    const listImportsRes = await v1.fetch(
      new Request("http://localhost:3000/imports", {
        headers: { cookie: signedCookieA },
      })
    )
    expect(listImportsRes.status).toBe(200)
    const listImportsBody = (await listImportsRes.json()) as any
    expect(listImportsBody.imports).toHaveLength(1)
    expect(listImportsBody.imports[0].id).toBe(importBody.importRunId)
    expect(listImportsBody.imports[0].status).toBe("running")
    expect(listImportsBody.imports[0].streams.map((stream: any) => stream.stream)).toEqual([
      "activity", "outbound_actions", "owned_notes", "owned_posts", "subscribers", "following",
    ])

    // 8. POST /imports/:id/pause
    const pauseRes = await v1.fetch(
      new Request(`http://localhost:3000/imports/${importBody.importRunId}/pause`, {
        method: "POST",
        headers: { cookie: signedCookieA },
      })
    )
    expect(pauseRes.status).toBe(200)
    const pauseBody = (await pauseRes.json()) as any
    expect(pauseBody.paused).toBe(true)

    // 9. POST /imports/:id/resume
    const resumeRes = await v1.fetch(
      new Request(`http://localhost:3000/imports/${importBody.importRunId}/resume`, {
        method: "POST",
        headers: { cookie: signedCookieA },
      })
    )
    expect(resumeRes.status).toBe(200)
    const resumeBody = (await resumeRes.json()) as any
    expect(resumeBody.resumed).toBe(true)
    expect(resumeBody.jobId).toBeDefined()

    // 10. DELETE /connection
    const delConnRes = await v1.fetch(
      new Request("http://localhost:3000/connection", {
        method: "DELETE",
        headers: { cookie: signedCookieA },
      })
    )
    expect(delConnRes.status).toBe(204)

    // Verify connection status is now revoked
    const getConnAfter = await v1.fetch(
      new Request("http://localhost:3000/connection", {
        headers: { cookie: signedCookieA },
      })
    )
    const getConnAfterBody = (await getConnAfter.json()) as any
    expect(getConnAfterBody.connection).toBeNull()
  })

  test("listPeople supports views, sorts, and nested tags/lists", async () => {
    const alice = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )
    const bob = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Bob", handle: "@bob" })
    )
    const charlie = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Charlie", handle: "@charlie" })
    )

    // Tag and list Alice
    const tag = await withTenant({ appUserId: userA }, (client) =>
      createTag(client, userA, "VIP", "#ff0000")
    )
    const list = await withTenant({ appUserId: userA }, (client) =>
      createList(client, userA, "Partners")
    )
    await withTenant({ appUserId: userA }, async (client) => {
      await attachTag(client, userA, tag.id, alice.id)
      await addListMember(client, userA, list.id, alice.id)
    })

    // Give Alice a conversation with score 6
    await withTenant({ appUserId: userA }, async (client) => {
      await recordInteraction(client, userA, {
        personId: alice.id,
        externalId: "ext-alice-1",
        direction: "inbound",
        actionType: "comment",
        occurredAt: new Date(Date.now() - 3600000).toISOString(),
        threadKind: "post",
        threadRootId: "thread-1",
      })
      await recordInteraction(client, userA, {
        personId: alice.id,
        externalId: "ext-alice-2",
        direction: "outbound",
        actionType: "reply",
        occurredAt: new Date().toISOString(),
        threadKind: "post",
        threadRootId: "thread-1",
      })
      await refreshPersonStats(client, alice.id)
    })

    // Give Bob a single like (score 1)
    await withTenant({ appUserId: userA }, async (client) => {
      await recordInteraction(client, userA, {
        personId: bob.id,
        externalId: "ext-bob-1",
        direction: "inbound",
        actionType: "like",
        occurredAt: new Date(Date.now() - 7200000).toISOString(),
      })
      await refreshPersonStats(client, bob.id)
    })

    // 1. View 'conversations'
    const convs = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { view: "conversations" })
    )
    expect(convs.map((p) => p.name)).toEqual(["Alice"])
    expect(convs[0].tags).toHaveLength(1)
    expect(convs[0].tags![0].name).toBe("VIP")
    expect(convs[0].lists).toHaveLength(1)
    expect(convs[0].lists![0].name).toBe("Partners")

    // 2. View 'no-history'
    const noHistory = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { view: "no-history" })
    )
    expect(noHistory.map((p) => p.name)).toEqual(["Charlie"])

    // 3. Sort by engagement
    const sorted = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { sort: "engagement" })
    )
    expect(sorted.map((p) => p.name)).toEqual(["Alice", "Bob", "Charlie"])
    expect(sorted[0].engagementScore).toBe(3)
    expect(sorted[1].engagementScore).toBe(1)
    expect(sorted[2].engagementScore).toBe(0)

    // 4. API GET /people with view and sort query
    const apiRes = await v1.fetch(
      new Request("http://localhost:3000/people?view=conversations&sort=engagement", {
        headers: { cookie: signedCookieA },
      })
    )
    expect(apiRes.status).toBe(200)
    const apiBody = (await apiRes.json()) as any
    expect(apiBody.people).toHaveLength(1)
    expect(apiBody.people[0].name).toBe("Alice")
  })

  test("list CRUD, description support, and deletion cascades membership without deleting people", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Test Contact", handle: "@testcontact" })
    )

    // 1. Create list via API with description
    const createRes = await v1.fetch(
      new Request("http://localhost:3000/lists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({ name: "Mentors", description: "Trusted mentors" }),
      })
    )
    expect(createRes.status).toBe(201)
    const { list } = (await createRes.json()) as any
    expect(list.name).toBe("Mentors")

    // 2. Add member to list
    const addMemberRes = await v1.fetch(
      new Request(`http://localhost:3000/lists/${list.id}/members`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({ personId: person.id }),
      })
    )
    expect(addMemberRes.status).toBe(204)

    // 3. Verify GET /lists includes description and count = 1
    const getListsRes = await v1.fetch(
      new Request("http://localhost:3000/lists", {
        headers: { cookie: signedCookieA },
      })
    )
    expect(getListsRes.status).toBe(200)
    const { lists } = (await getListsRes.json()) as any
    const found = lists.find((l: any) => l.id === list.id)
    expect(found).toBeDefined()
    expect(found.name).toBe("Mentors")
    expect(found.description).toBe("Trusted mentors")
    expect(found.count).toBe(1)

    // 4. Update list via PATCH
    const patchRes = await v1.fetch(
      new Request(`http://localhost:3000/lists/${list.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({ name: "Senior Mentors", description: "Key strategic advisors" }),
      })
    )
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as any
    expect(patched.list.name).toBe("Senior Mentors")

    // 5. Delete list via DELETE
    const deleteRes = await v1.fetch(
      new Request(`http://localhost:3000/lists/${list.id}`, {
        method: "DELETE",
        headers: { cookie: signedCookieA },
      })
    )
    expect(deleteRes.status).toBe(204)

    // 6. Verify list is gone
    const getListsAfter = await v1.fetch(
      new Request("http://localhost:3000/lists", {
        headers: { cookie: signedCookieA },
      })
    )
    const listsAfter = (await getListsAfter.json()) as any
    expect(listsAfter.lists.some((l: any) => l.id === list.id)).toBe(false)

    // 7. Verify person STILL exists and has no lists
    const peopleAfter = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "Test Contact" })
    )
    expect(peopleAfter).toHaveLength(1)
    expect(peopleAfter[0].id).toBe(person.id)
    expect(peopleAfter[0].lists ?? []).toHaveLength(0)
  })

  test("PATCH /people/:id edits person profile fields without altering interactions", async () => {
    // 1. Create a person without handle
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "No Handle User" })
    )
    expect(person.handle).toBeNull()

    // 2. Edit profile fields: add handle, publicationUrl, avatarUrl, etc.
    const patchRes = await v1.fetch(
      new Request(`http://localhost:3000/people/${person.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          name: "Updated Name",
          handle: "@newhandle",
          avatarUrl: "https://substackcdn.com/avatar.jpg",
          profileUrl: "https://substack.com/@newhandle",
          publicationUrl: "https://newhandle.substack.com",
          substackProfileId: "98765432",
          relationshipStatus: "conversation",
          isFollower: true,
          isFollowing: true,
          isSubscriber: false,
          isSubscribedTo: true,
        }),
      })
    )
    expect(patchRes.status).toBe(200)
    const patchData = (await patchRes.json()) as any
    expect(patchData.person.name).toBe("Updated Name")
    expect(patchData.person.handle).toBe("newhandle")
    expect(patchData.person.avatarUrl).toBe("https://substackcdn.com/avatar.jpg")
    expect(patchData.person.profileUrl).toBe("https://substack.com/@newhandle")
    expect(patchData.person.publicationUrl).toBe("https://newhandle.substack.com")
    expect(patchData.person.substackProfileId).toBe("98765432")
    expect(patchData.person.relationshipStatus).toBe("conversation")
    expect(patchData.person).toMatchObject({
      isFollower: true,
      isFollowing: true,
      isSubscriber: false,
      isSubscribedTo: true,
    })

    // 3. Create another person with handle @other
    await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Other User", handle: "@other" })
    )

    // 4. Try to update person's handle to @other -> should return 409
    const conflictRes = await v1.fetch(
      new Request(`http://localhost:3000/people/${person.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: signedCookieA,
        },
        body: JSON.stringify({
          handle: "@other",
        }),
      })
    )
    expect(conflictRes.status).toBe(409)
    const conflictData = (await conflictRes.json()) as any
    expect(conflictData.error).toContain("handle already exists")
  })

  test("subscriber import keeps distinct stable IDs separate despite a shared name and avatar", async () => {
    const original = await withTenant({ appUserId: userA }, async (client) => {
      const person = await createPerson(client, userA, {
        name: "Adam",
        handle: "@first_adam",
        substackProfileId: "stable-1",
      })
      await client.query("update people set avatar_url = $2 where id = $1", [person.id, "https://example.com/shared.png"])
      return person
    })

    const result = await withTenant({ appUserId: userA }, (client) =>
      upsertSubscribersBatch(client, userA, [{
        id: "stable-2",
        name: "Adam",
        photo_url: "https://example.com/shared.png",
      }], new Date().toISOString())
    )
    expect(result).toMatchObject({ matched: 0, created: 1, skipped: 0 })

    const people = await withTenant({ appUserId: userA }, (client) =>
      client.query("select id, substack_profile_id, is_subscriber from people where name = 'Adam' order by substack_profile_id")
    )
    expect(people.rows).toHaveLength(2)
    expect(people.rows[0]).toMatchObject({ id: original.id, substack_profile_id: "stable-1", is_subscriber: false })
    expect(people.rows[1]).toMatchObject({ substack_profile_id: "stable-2", is_subscriber: true })

    const conflict = await withTenant({ appUserId: userA }, async (client) => {
      const upserted = await upsertSubscribersBatch(client, userA, [{
        id: "stable-3", name: "Another Adam", handle: "first_adam",
      }], new Date().toISOString())
      const person = await client.query("select handle, substack_profile_id from people where substack_profile_id = 'stable-3'")
      return { upserted, person: person.rows[0] }
    })
    expect(conflict.upserted.created).toBe(1)
    expect(conflict.person).toMatchObject({ handle: null, substack_profile_id: "stable-3" })
  })

  test("subscriber sweep keeps the email to profile ID pair per tenant", async () => {
    const pair = (email: string) => ({ id: "email-profile", name: "Reader", email })
    await withTenant({ appUserId: userA }, (client) => upsertSubscribersBatch(client, userA, [pair("old@example.com")]))
    await withTenant({ appUserId: userA }, (client) => upsertSubscribersBatch(client, userA, [pair("old@example.com"), pair("new@example.com")]))
    const own = await withTenant({ appUserId: userA }, (client) =>
      client.query("select email, substack_profile_id from subscriber_emails order by email"))
    expect(own.rows).toEqual([
      { email: "new@example.com", substack_profile_id: "email-profile" },
      { email: "old@example.com", substack_profile_id: "email-profile" },
    ])
    const other = await withTenant({ appUserId: userB }, (client) => client.query("select 1 from subscriber_emails"))
    expect(other.rows).toHaveLength(0)
  })

  test("interaction ingestion keeps distinct stable IDs separate despite a shared name and avatar", async () => {
    const people = await withTenant({ appUserId: userA }, async (client) => {
      const cache = new Map<string, string>()
      const first = await ensurePerson(client, userA, cache, {
        id: "profile-one", name: "Alex", handle: "alex_one", photo_url: "https://example.com/shared.png",
      })
      const second = await ensurePerson(client, userA, cache, {
        id: "profile-two", name: "Alex", photo_url: "https://example.com/shared.png",
      })
      const third = await ensurePerson(client, userA, cache, {
        id: "profile-three", name: "Another Alex", handle: "alex_one",
      })
      return { first, second, third }
    })
    expect(people.first).toBeTruthy()
    expect(people.second).toBeTruthy()
    expect(people.second).not.toBe(people.first)
    expect(people.third).not.toBe(people.first)
  })

  test("handle-only activity reuses a contact that already has a stable profile ID", async () => {
    const existing = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, {
        name: "Known Reader",
        handle: "known_reader",
        substackProfileId: "known-reader-profile",
      })
    )

    const result = await withTenant({ appUserId: userA }, async (client) => {
      const stats = await ingestActivityBatch(client, {
        userId: userA,
        ownerHandle: "owner",
        items: [{
          id: "handle-only-like",
          kind: "like",
          actor: { name: "Known Reader", handle: "known_reader" },
        }],
      })
      const people = await client.query(
        "select id from people where normalized_handle = 'known_reader' order by id",
      )
      const interaction = await client.query(
        "select person_id from interactions where external_id = 'handle-only-like'",
      )
      return { stats, people: people.rows, interaction: interaction.rows[0] }
    })

    expect(result.stats).toMatchObject({ processedItems: 1, newPeople: 0, newInteractions: 1 })
    expect(result.people).toEqual([{ id: existing.id }])
    expect(result.interaction).toEqual({ person_id: existing.id })
  })

  test("ingestion fills a missing profile URL for an existing matching handle", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, {
        name: "Mariam", handle: "mariamvossough", substackProfileId: "stable-mariam",
      })
    )
    await withTenant({ appUserId: userA }, (client) =>
      client.query("update people set profile_url = null where id = $1", [person.id])
    )
    const profileUrl = await withTenant({ appUserId: userA }, async (client) => {
      await ensurePerson(client, userA, new Map(), {
        id: "stable-mariam", name: "Mariam", handle: "mariamvossough",
      })
      const result = await client.query("select profile_url from people where id = $1", [person.id])
      return result.rows[0].profile_url
    })
    expect(profileUrl).toBe("https://substack.com/@mariamvossough")
  })

  test("profile URL migration fills missing handle links and preserves custom URLs", async () => {
    const missing = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Missing link", handle: "missing_link" })
    )
    const custom = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, {
        name: "Custom link", handle: "custom_link", profileUrl: "https://example.com/custom",
      })
    )
    await migrate.query("update people set profile_url = null where id = $1", [missing.id])
    const sql = await readFile(new URL("../migrations/025_backfill_missing_profile_urls.sql", import.meta.url), "utf8")
    await migrate.query(sql)
    const result = await migrate.query("select id, profile_url from people where id = any($1::text[])", [[missing.id, custom.id]])
    expect(result.rows.find((row) => row.id === missing.id)?.profile_url).toBe("https://substack.com/@missing_link")
    expect(result.rows.find((row) => row.id === custom.id)?.profile_url).toBe("https://example.com/custom")
  })

  test("follower sweep retirement closes queued work without touching other streams", async () => {
    await migrate.query(`insert into substack_connections (id,user_id,envelope_version,key_id,wrapped_key,iv,ciphertext,status)
      values ('retire-connection',$1,1,'plain','','','synthetic-private-session','active')`, [userA])
    await migrate.query(`insert into import_runs (id,user_id,connection_id,cutoff) values
      ('only-followers-left',$1,'retire-connection',now()), ('still-importing',$1,'retire-connection',now())`, [userA])
    await migrate.query(`insert into import_run_streams (import_run_id,user_id,connection_id,stream,status) values
      ('only-followers-left',$1,'retire-connection','followers','running'),
      ('only-followers-left',$1,'retire-connection','activity','complete'),
      ('still-importing',$1,'retire-connection','followers','paused'),
      ('still-importing',$1,'retire-connection','activity','running')`, [userA])
    await migrate.query(`insert into jobs (type,payload,status) values
      ('sync:followers','{}','pending'), ('sync:followers','{}','done'), ('sync:following','{}','pending')`)
    await migrate.query(await readFile(new URL("../migrations/035_retire_follower_sweep.sql", import.meta.url), "utf8"))
    const jobs = await migrate.query("select type, status from jobs order by id")
    expect(jobs.rows).toEqual([
      { type: "sync:followers", status: "dead" }, { type: "sync:followers", status: "done" }, { type: "sync:following", status: "pending" },
    ])
    const streams = await migrate.query("select import_run_id, stream, status from import_run_streams order by 1, 2")
    expect(streams.rows).toEqual([
      { import_run_id: "only-followers-left", stream: "activity", status: "complete" },
      { import_run_id: "only-followers-left", stream: "followers", status: "unavailable" },
      { import_run_id: "still-importing", stream: "activity", status: "running" },
      { import_run_id: "still-importing", stream: "followers", status: "unavailable" },
    ])
    const runs = await migrate.query("select id, status from import_runs order by id")
    expect(runs.rows).toEqual([{ id: "only-followers-left", status: "complete" }, { id: "still-importing", status: "running" }])
  })

  test("following sweep imports missing profiles and reconciles outbound status", async () => {
    const existing = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, {
        name: "Existing Follow", handle: "@existing_follow", substackProfileId: "following-1",
      })
    )
    const first = await withTenant({ appUserId: userA }, (client) =>
      applyFollowingSnapshot(client, userA, [
        { id: "following-1", handle: "existing_follow", isSubscribed: false },
        { id: "following-2", handle: "new_follow", name: "New Follow", isSubscribed: true },
      ])
    )
    expect(first).toMatchObject({ following: 2, subscribed: 1, created: 1 })
    const imported = await withTenant({ appUserId: userA }, (client) =>
      client.query("select id, is_following, is_subscribed_to from people where substack_profile_id = 'following-2'")
    )
    expect(imported.rows[0]).toMatchObject({ is_following: true, is_subscribed_to: true })

    const second = await withTenant({ appUserId: userA }, (client) =>
      applyFollowingSnapshot(client, userA, [{ id: "following-2", handle: "new_follow", isSubscribed: false }])
    )
    expect(second).toMatchObject({ following: 1, subscribed: 0, created: 0 })
    const previous = await withTenant({ appUserId: userA }, (client) =>
      client.query("select is_following from people where id = $1", [existing.id])
    )
    expect(previous.rows[0]?.is_following).toBe(false)

    // The ID-only feed leaves stored subscription state alone.
    const idOnly = await withTenant({ appUserId: userA }, (client) =>
      applyFollowingSnapshot(client, userA, [{ id: "following-1", handle: null, isSubscribed: false }], false)
    )
    expect(idOnly).toMatchObject({ following: 1, created: 0 })
    const kept = await withTenant({ appUserId: userA }, (client) =>
      client.query("select substack_profile_id, is_following, is_subscribed_to from people order by substack_profile_id")
    )
    expect(kept.rows).toEqual([
      { substack_profile_id: "following-1", is_following: true, is_subscribed_to: false },
      { substack_profile_id: "following-2", is_following: false, is_subscribed_to: false },
    ])
  })

  test("handle backfill names contacts created from the ID-only following feed", async () => {
    await migrate.query(`insert into substack_connections (id,user_id,envelope_version,key_id,wrapped_key,iv,ciphertext,status)
      values ('handle-connection',$1,1,'plain','','','synthetic-private-session','active')`, [userA])
    await withTenant({ appUserId: userA }, (client) =>
      applyFollowingSnapshot(client, userA, [{ id: "4242", handle: null, isSubscribed: false }], false))
    await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Unresolvable Subscriber", substackProfileId: "5555" }))
    const { processMissingHandleBackfill } = await import(new URL("../../worker/src/audience.ts", import.meta.url).href)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes("/reader/feed/profile/4242")) return Response.json({ items: [{ context: { users: [{ id: 4242, handle: "tester" }] } }] })
      if (url.includes("/public_profile")) return Response.json({ id: 4242, name: "Tester", handle: "tester", photo_url: "https://example.test/t.png" })
      return new Response("unexpected request in test", { status: 500 })
    }) as typeof fetch
    const client = await db.connect()
    try {
      expect(await processMissingHandleBackfill(client, userA, "handle-connection", null, true)).toMatchObject({ recovered: 1 })
      // The handle-less subscriber is not a sweep placeholder, so it is never looked up.
      expect(await processMissingHandleBackfill(client, userA, "handle-connection", null, true)).toMatchObject({ completed: true, checked: 0 })
    } finally { client.release(); globalThis.fetch = originalFetch }
    const person = await withTenant({ appUserId: userA }, (client) =>
      client.query("select name, handle, avatar_url, profile_url, is_following from people where substack_profile_id = '4242'"))
    expect(person.rows[0]).toEqual({ name: "Tester", handle: "tester", avatar_url: "https://example.test/t.png",
      profile_url: "https://substack.com/@tester", is_following: true })
  })

  test("follows-not-subscribed view, ignored isolation, and subscriber batch upsert", async () => {
    // 1. Create a follower who is not subscribed
    const follower = await withTenant({ appUserId: userA }, async (client) => {
      const p = await createPerson(client, userA, {
        name: "Follower Only",
        handle: "@follower_only",
        substackProfileId: "1110001",
      })
      await client.query("update people set is_follower = true, is_subscriber = false where id = $1", [p.id])
      return p
    })

    // 2. Create an ignored person
    const ignoredPerson = await withTenant({ appUserId: userA }, async (client) => {
      const p = await createPerson(client, userA, {
        name: "Spammer Account",
        handle: "@spammer",
      })
      const ignoredList = await createList(client, userA, "Ignored", "Ignored users")
      await addListMember(client, userA, ignoredList.id, p.id)
      return p
    })

    // 3. Verify ignoredPerson does NOT appear in listPeople with view "all"
    const allPeople = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { view: "all" })
    )
    expect(allPeople.some((p) => p.id === ignoredPerson.id)).toBe(false)
    expect(allPeople.some((p) => p.id === follower.id)).toBe(true)

    // 4. Verify ignoredPerson DOES appear in listPeople with view "ignored"
    const ignoredOnly = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { view: "ignored" })
    )
    expect(ignoredOnly.some((p) => p.id === ignoredPerson.id)).toBe(true)
    expect(ignoredOnly.some((p) => p.id === follower.id)).toBe(false)

    // 5. Verify follower appears in listPeople with view "follows-not-subscribed"
    const followsNotSub = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { view: "follows-not-subscribed" })
    )
    expect(followsNotSub.some((p) => p.id === follower.id)).toBe(true)
    expect(followsNotSub.some((p) => p.id === ignoredPerson.id)).toBe(false)

    // 6. Test an authoritative subscriber sweep in both directions.
    const staleSubscriber = await withTenant({ appUserId: userA }, async (client) => {
      const p = await createPerson(client, userA, {
        name: "Former Subscriber",
        handle: "@former_subscriber",
        substackProfileId: "1110002",
      })
      await client.query(
        "update people set is_subscriber = true, subscriber_checked_at = now() - interval '1 day' where id = $1",
        [p.id],
      )
      return p
    })
    const runStartedAt = new Date(Date.now() - 1_000).toISOString()
    const batchRes = await withTenant({ appUserId: userA }, (client) =>
      upsertSubscribersBatch(client, userA, [
        {
          id: "1110001",
          name: "Follower Only",
          subscription_type: "paid",
        },
      ], new Date().toISOString())
    )
    expect(batchRes.matched).toBe(1)
    const deactivated = await withTenant({ appUserId: userA }, (client) =>
      reconcileSubscriberSnapshot(client, userA, runStartedAt)
    )
    expect(deactivated).toBe(1)

    // 7. Verify the current subscriber stays subscribed and the missing one is cleared.
    const updatedFollower = await withTenant({ appUserId: userA }, (client) =>
      getPerson(client, follower.id)
    )
    expect(updatedFollower?.person.isSubscriber).toBe(true)
    expect(updatedFollower?.person.subscriptionTier).toBe("paid")
    const updatedStaleSubscriber = await withTenant({ appUserId: userA }, (client) =>
      getPerson(client, staleSubscriber.id)
    )
    expect(updatedStaleSubscriber?.person.isSubscriber).toBe(false)
    expect(updatedStaleSubscriber?.person.subscriptionTier).toBeNull()

    const followsNotSubAfter = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { view: "follows-not-subscribed" })
    )
    expect(followsNotSubAfter.some((p) => p.id === follower.id)).toBe(false)

    // 8. Verify circlesOverview counts
    const overview = await withTenant({ appUserId: userA }, (client) =>
      circlesOverview(client)
    )
    expect(overview.ignored).toBeGreaterThanOrEqual(1)
    // Per-action breakdown covers every active interaction exactly once.
    expect(overview.actions.reduce((sum, row) => sum + row.total, 0)).toBe(overview.interactions)
    for (const row of overview.actions) expect(row.last7d).toBeLessThanOrEqual(row.last30d)
  })
})


// Note scheduling runs inside this file because it owns the shared database
// and auth pools for the whole test process.
/** In-memory stand-in for Substack's Note draft endpoints. */
class FakeSubstack {
  drafts = new Map<number, Record<string, any>>()
  requests: string[] = []
  nextId = 900
  failNext: { status: number; body: unknown } | null = null

  handle = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/api\/v1/, "")
    this.requests.push(`${request.method} ${path}`)
    if (this.failNext) {
      const failure = this.failNext
      this.failNext = null
      return Response.json(failure.body, { status: failure.status })
    }
    const body = request.method === "GET" || request.method === "DELETE" ? null : await request.json().catch(() => null)
    const draftFrom = (id: number, data: any) => ({
      id,
      body_json: data.bodyJson,
      trigger_at: data.trigger_at ?? null,
      reply_minimum_role: data.replyMinimumRole ?? null,
      attachments: (data.attachmentIds ?? []).map((attachmentId: string) => ({ id: attachmentId, type: "image" })),
      status: "draft",
    })
    if (request.method === "POST" && path === "/comment/draft") {
      const draft = draftFrom(this.nextId++, body)
      this.drafts.set(draft.id, draft)
      return Response.json(draft)
    }
    const patch = path.match(/^\/feed\/comment\/(\d+)$/)
    if (request.method === "PATCH" && patch) {
      const id = Number(patch[1])
      if (!this.drafts.has(id)) return new Response("", { status: 404 })
      const draft = draftFrom(id, body)
      this.drafts.set(id, draft)
      return Response.json(draft)
    }
    const remove = path.match(/^\/comment\/(\d+)$/)
    if (request.method === "DELETE" && remove) {
      if (!this.drafts.delete(Number(remove[1]))) return new Response("", { status: 403 })
      return Response.json({})
    }
    if (request.method === "GET" && path === "/feed/drafts") {
      return Response.json({ drafts: [...this.drafts.values()], hasMore: false, nextCursor: null })
    }
    if (request.method === "POST" && path === "/comment/attachment") {
      return Response.json({ id: `att-${this.nextId++}`, type: body.type })
    }
    if (request.method === "POST" && path === "/image") {
      return Response.json({ id: this.nextId++, url: "https://substack-post-media.s3.amazonaws.com/public/images/test.png",
        contentType: "image/png", bytes: 16, imageWidth: 1, imageHeight: 1 })
    }
    return new Response("unexpected request in test", { status: 500 })
  }
}


describe("note scheduling", () => {
  const originalFetch = globalThis.fetch
  let substack: FakeSubstack
  let cookieA = ""
  let cookieB = ""

  const call = (method: string, path: string, body?: unknown, cookie = cookieA) =>
    v1.fetch(
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )

  const doc = (value: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] })
  const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  beforeAll(async () => {
    const { makeSignature } = await import("better-auth/crypto")
    for (const [authId, token, setCookie] of [
      [authA, "notes-token-a", (value: string) => (cookieA = value)],
      [authB, "notes-token-b", (value: string) => (cookieB = value)],
    ] as const) {
      const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!)
      setCookie(`better-auth.session_token=${encodeURIComponent(token)}.${signature}`)
      await migrate.query(
        `insert into session (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
         values ($1, $2, $3, now() + interval '1 day', now(), now())
         on conflict (id) do nothing`,
        [`sess-notes-${authId}`, authId, token],
      )
    }
  })

  beforeEach(async () => {
    await migrate.query(
      `insert into substack_connections
         (id, user_id, generation, status, envelope_version, key_id, wrapped_key, iv, ciphertext, profile_id, profile_handle)
       values ('conn-notes-a', $1, 1, 'active', 1, 'plain', 'plain', 'plain', 'session-a', '4242', 'tester'),
              ('conn-notes-b', $2, 1, 'active', 1, 'plain', 'plain', 'plain', 'session-b', '4343', 'other')`,
      [userA, userB],
    )
    substack = new FakeSubstack()
    globalThis.fetch = substack.handle as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("schedules a Note once per client request ID", async () => {
    const request = {
      clientRequestId: "req-schedule-1",
      bodyJson: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "substack_mention", attrs: { id: 11, label: "Jane Doe", mentionType: "user", url: null } },
            { type: "text", text: " friend", marks: [{ type: "bold" }] },
          ],
        }],
      },
      attachments: [{ type: "link", url: "https://example.com/post" }],
      mode: "schedule",
      triggerAt: inOneDay(),
    }
    const first = await call("POST", "/notes", request)
    expect(first.status).toBe(201)
    const { note } = (await first.json()) as any
    expect(note).toMatchObject({ status: "scheduled", origin: "circles", editable: true, postNow: false })
    expect(note.bodyText).toBe("Hello @Jane Doe friend")
    expect(note.mentions).toEqual([{ id: 11, label: "Jane Doe" }])
    expect(note.attachments).toHaveLength(1)

    const repeat = await call("POST", "/notes", request)
    expect(repeat.status).toBe(200)
    expect(((await repeat.json()) as any).note.id).toBe(note.id)
    expect(substack.requests.filter((line) => line === "POST /comment/draft")).toHaveLength(1)
  })

  test("saves drafts, schedules them, and moves them back to drafts", async () => {
    const created = (await (await call("POST", "/notes", {
      clientRequestId: "req-draft-1",
      bodyJson: doc("Draft first"),
      mode: "draft",
    })).json()) as any
    expect(created.note).toMatchObject({ status: "draft", triggerAt: null })

    const triggerAt = inOneDay()
    const scheduled = (await (await call("PATCH", `/notes/${created.note.id}`, { mode: "schedule", triggerAt })).json()) as any
    expect(scheduled.note.status).toBe("scheduled")
    expect(scheduled.note.triggerAt).toBe(triggerAt)

    const unscheduled = (await (await call("PATCH", `/notes/${created.note.id}`, { mode: "draft" })).json()) as any
    expect(unscheduled.note).toMatchObject({ status: "draft", triggerAt: null })
  })

  test("post now schedules a minute ahead and abort keeps it as a draft", async () => {
    const before = Date.now()
    const { note } = (await (await call("POST", "/notes", {
      clientRequestId: "req-now-1",
      bodyJson: doc("Posting now"),
      mode: "post_now",
    })).json()) as any
    expect(note).toMatchObject({ status: "scheduled", postNow: true })
    const delay = new Date(note.triggerAt).getTime() - before
    expect(delay).toBeGreaterThan(55_000)
    expect(delay).toBeLessThan(65_000)

    const aborted = await call("POST", `/notes/${note.id}/abort`)
    expect(aborted.status).toBe(200)
    expect(((await aborted.json()) as any).note).toMatchObject({ status: "draft", postNow: false, triggerAt: null })

    // Too close to trigger_at, aborting could race Substack's publish.
    const again = (await (await call("POST", "/notes", {
      clientRequestId: "req-now-2",
      bodyJson: doc("Posting again"),
      mode: "post_now",
    })).json()) as any
    await migrate.query("update scheduled_notes set trigger_at = now() + interval '2 seconds' where id = $1", [again.note.id])
    expect((await call("POST", `/notes/${again.note.id}/abort`)).status).toBe(409)
  })

  test("rejects invalid times and attachments without calling Substack", async () => {
    const tooFar = await call("POST", "/notes", {
      clientRequestId: "req-bad-1",
      bodyJson: doc("Too far"),
      mode: "schedule",
      triggerAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(tooFar.status).toBe(400)
    const twoLinks = await call("POST", "/notes", {
      clientRequestId: "req-bad-2",
      bodyJson: doc("Two links"),
      mode: "draft",
      attachments: [{ type: "link", url: "https://a.example" }, { type: "link", url: "https://b.example" }],
    })
    expect(twoLinks.status).toBe(400)
    expect(substack.requests).toHaveLength(0)
  })

  test("an upstream failure removes the pending row and reports Substack's message", async () => {
    substack.failNext = { status: 400, body: { error: "Please type a shorter comment" } }
    const res = await call("POST", "/notes", { clientRequestId: "req-fail-1", bodyJson: doc("Hello"), mode: "draft" })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error).toBe("Please type a shorter comment")
    const rows = await migrate.query("select count(*)::int as count from scheduled_notes")
    expect(rows.rows[0].count).toBe(0)
  })

  test("an upstream 401 marks the connection expired", async () => {
    substack.failNext = { status: 401, body: { error: "Unauthorized" } }
    const res = await call("POST", "/notes", { clientRequestId: "req-expired-1", bodyJson: doc("Hello"), mode: "draft" })
    expect(res.status).toBe(401)
    const conn = await migrate.query("select status from substack_connections where id = 'conn-notes-a'")
    expect(conn.rows[0].status).toBe("expired")
  })

  test("deleting a scheduled Note removes it upstream", async () => {
    const { note } = (await (await call("POST", "/notes", {
      clientRequestId: "req-delete-1",
      bodyJson: doc("Delete me"),
      mode: "schedule",
      triggerAt: inOneDay(),
    })).json()) as any
    expect((await call("DELETE", `/notes/${note.id}`)).status).toBe(204)
    expect(substack.drafts.size).toBe(0)
    const list = (await (await call("GET", "/notes")).json()) as any
    expect(list.notes).toHaveLength(0)
  })

  test("refresh imports Substack drafts and classifies vanished ones", async () => {
    const past = (await (await call("POST", "/notes", {
      clientRequestId: "req-publish-1",
      bodyJson: doc("Will publish"),
      mode: "schedule",
      triggerAt: inOneDay(),
    })).json()) as any
    const removed = (await (await call("POST", "/notes", {
      clientRequestId: "req-removed-1",
      bodyJson: doc("Removed in Substack"),
      mode: "schedule",
      triggerAt: inOneDay(),
    })).json()) as any
    // Substack published the first (its trigger passed) and the user deleted
    // the second in Substack's own app; a third draft was made there.
    await migrate.query("update scheduled_notes set trigger_at = now() - interval '1 minute' where id = $1", [past.note.id])
    substack.drafts.clear()
    substack.drafts.set(777, {
      id: 777,
      body: "From Substack",
      body_json: { type: "doc", attrs: { schemaVersion: "v1", title: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "From Substack" }] }] },
      trigger_at: inOneDay(),
      attachments: [],
    })

    const res = await call("POST", "/notes/refresh?force=1")
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.refreshed).toBe(true)
    const byDraft = new Map(body.notes.map((note: any) => [note.substackDraftId, note]))
    expect(byDraft.get(past.note.substackDraftId)).toMatchObject({
      status: "published",
      noteUrl: `https://substack.com/@tester/note/c-${past.note.substackDraftId}`,
    })
    expect(byDraft.has(removed.note.substackDraftId)).toBe(false)
    expect(byDraft.get("777")).toMatchObject({ status: "scheduled", origin: "substack", editable: true })

    // A second refresh inside the throttle window does not read Substack again.
    const reads = substack.requests.filter((line) => line === "GET /feed/drafts").length
    await call("POST", "/notes/refresh")
    expect(substack.requests.filter((line) => line === "GET /feed/drafts").length).toBe(reads)
  })

  test("tenants cannot see or change each other's Notes", async () => {
    const { note } = (await (await call("POST", "/notes", {
      clientRequestId: "req-tenant-1",
      bodyJson: doc("Private"),
      mode: "draft",
    })).json()) as any
    const listB = (await (await call("GET", "/notes", undefined, cookieB)).json()) as any
    expect(listB.notes).toHaveLength(0)
    expect((await call("DELETE", `/notes/${note.id}`, undefined, cookieB)).status).toBe(404)
    const stillThere = await withTenant({ appUserId: userA }, (client) =>
      client.query("select status from scheduled_notes where id = $1", [note.id]),
    )
    expect(stillThere.rows[0].status).toBe("draft")
  })

  test("creates, renames, attaches, and deletes Note tags", async () => {
    const created = await call("POST", "/notes/tags", { name: "Growth", color: "#2563eb" })
    expect(created.status).toBe(201)
    const growth = ((await created.json()) as any).tag
    expect(growth).toMatchObject({ name: "Growth", color: "#2563eb", count: 0 })
    expect((await call("POST", "/notes/tags", { name: "growth" })).status).toBe(409)
    const launch = ((await (await call("POST", "/notes/tags", { name: "Launch" })).json()) as any).tag

    // Tags sent with a new Note are attached to it.
    const { note } = (await (await call("POST", "/notes", {
      clientRequestId: "req-tags-1",
      bodyJson: doc("Tagged"),
      mode: "draft",
      tagIds: [growth.id],
    })).json()) as any
    expect(note.tags.map((tag: any) => tag.name)).toEqual(["Growth"])

    // Editing the Note keeps its tags; PUT replaces the set.
    const edited = (await (await call("PATCH", `/notes/${note.id}`, { mode: "schedule", triggerAt: inOneDay() })).json()) as any
    expect(edited.note.tags.map((tag: any) => tag.name)).toEqual(["Growth"])
    const replaced = (await (await call("PUT", `/notes/${note.id}/tags`, { tagIds: [launch.id] })).json()) as any
    expect(replaced.note.tags.map((tag: any) => tag.name)).toEqual(["Launch"])

    const renamed = await call("PATCH", `/notes/tags/${launch.id}`, { name: "Launches", color: "#16a34a" })
    expect(((await renamed.json()) as any).tag).toMatchObject({ name: "Launches", color: "#16a34a" })
    const tags = ((await (await call("GET", "/notes/tags")).json()) as any).tags
    expect(tags.map((tag: any) => [tag.name, tag.count])).toEqual([["Growth", 0], ["Launches", 1]])

    // Another tenant cannot see the tags or tag this Note.
    expect(((await (await call("GET", "/notes/tags", undefined, cookieB)).json()) as any).tags).toHaveLength(0)
    expect((await call("PUT", `/notes/${note.id}/tags`, { tagIds: [] }, cookieB)).status).toBe(404)

    expect((await call("DELETE", `/notes/tags/${launch.id}`)).status).toBe(204)
    const list = ((await (await call("GET", "/notes")).json()) as any).notes
    expect(list.find((item: any) => item.id === note.id).tags).toEqual([])
    expect(substack.requests.filter((line) => line.includes("tag"))).toHaveLength(0)
  })

  test("tags a published Note that only exists in owned content", async () => {
    await migrate.query(
      `insert into owned_content (id, user_id, connection_id, kind, external_id, body, published_at, raw)
       values ('owned-note-1', $1, 'conn-notes-a', 'note', '991', 'Published elsewhere', now() - interval '1 day', $2)`,
      [userA, JSON.stringify({ comment: { id: 991, attachments: [{
        id: "att-post", type: "post", publication: { name: "The Pub" },
        post: { canonical_url: "https://pub.example/p/x", title: "T", subtitle: "S", cover_image: "https://img.example/c.png", body_html: "<p>long</p>" },
      }] } })],
    )
    const restack = { url: "https://pub.example/p/x", title: "T", subtitle: "S", coverImage: "https://img.example/c.png", publicationName: "The Pub" }
    const before = ((await (await call("GET", "/notes")).json()) as any).notes.find((item: any) => item.id === "note:991")
    // Feed items nest the Note under `comment`; the quoted post's body never reaches the page.
    expect(before.attachments).toEqual([{ id: "att-post", type: "post", post: restack }])
    const tag = ((await (await call("POST", "/notes/tags", { name: "Evergreen" })).json()) as any).tag
    const res = await call("PUT", "/notes/note:991/tags", { tagIds: [tag.id] })
    expect(res.status).toBe(200)
    const { note } = (await res.json()) as any
    expect(note).toMatchObject({ status: "published", substackDraftId: "991", bodyText: "Published elsewhere" })
    expect(note.tags.map((item: any) => item.name)).toEqual(["Evergreen"])

    // The list now shows the mirror row once, with its tag.
    const list = ((await (await call("GET", "/notes")).json()) as any).notes
    const matches = list.filter((item: any) => item.substackDraftId === "991")
    expect(matches).toHaveLength(1)
    expect(matches[0].tags.map((item: any) => item.name)).toEqual(["Evergreen"])
    expect(matches[0].attachments[0].post).toEqual(restack)
  })

  test("identifies supported image formats by their bytes", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png")
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(sniffImageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp")
    expect(sniffImageType(new TextEncoder().encode("<svg></svg>"))).toBeNull()
  })
})

describe("MCP OAuth and tenant operations", () => {
  let cookieA = ""
  let cookieB = ""
  const originalFetch = globalThis.fetch
  afterAll(() => { globalThis.fetch = originalFetch })
  beforeAll(async () => {
    const { makeSignature } = await import("better-auth/crypto")
    for (const [authId, token, setCookie] of [
      [authA, "mcp-session-a", (value: string) => (cookieA = value)],
      [authB, "mcp-session-b", (value: string) => (cookieB = value)],
    ] as const) {
      const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!)
      setCookie(`better-auth.session_token=${encodeURIComponent(token)}.${signature}`)
      await migrate.query(`insert into session(id,"userId",token,"expiresAt","createdAt","updatedAt")
        values ($1,$2,$3,now()+interval '1 day',now(),now()) on conflict(id) do nothing`, [`mcp-${authId}`,authId,token])
    }
  })

  function dpopSigner() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    return (url: string, accessToken?: string) => {
      const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: publicKey.export({ format: "jwk" }) })).toString("base64url")
      const payload = Buffer.from(JSON.stringify({
        jti: randomUUID(), htm: accessToken ? "GET" : "POST", htu: url, iat: Math.floor(Date.now() / 1000),
        ...(accessToken && { ath: createHash("sha256").update(accessToken).digest("base64url") }),
      })).toString("base64url")
      const input = `${header}.${payload}`
      return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`
    }
  }

  async function connectSubstack() {
    await migrate.query(`insert into substack_connections (id,user_id,envelope_version,key_id,wrapped_key,iv,ciphertext,status,profile_handle)
      values ('mcp-connection',$1,1,'plain','','','synthetic-private-session','active','tester')`, [userA])
  }

  async function authorize(cookie: string, scopes = "circles:read substack:read offline_access", proof?: ReturnType<typeof dpopSigner>) {
    const headers = new Headers({ cookie })
    const client = await auth.api.createOAuthClient({ headers, body: {
      client_name: "Circles test agent", redirect_uris: ["https://client.test/callback"],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], scope: scopes,
      ...(proof && { dpop_bound_access_tokens: true }),
    } })
    const verifier = "v".repeat(43)
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: "https://client.test/callback",
      response_type: "code", scope: scopes, resource: mcpResource, state: "test-state", code_challenge: challenge, code_challenge_method: "S256" })
    const response = await auth.handler(new Request(`${new URL(mcpResource).origin}/api/auth/oauth2/authorize?${query}`, { headers }))
    expect(response.status).toBe(302)
    const consentUrl = new URL(response.headers.get("location")!, mcpResource)
    expect(consentUrl.pathname).toBe("/mcp/consent")
    const consentQuery = consentUrl.search.slice(1)
    const preview = await mcpBrowserRoutes.request(`/consent?oauth_query=${encodeURIComponent(consentQuery)}`, { headers })
    expect(preview.status).toBe(200)
    const consentResponse = await auth.handler(new Request(`${new URL(mcpResource).origin}/api/auth/oauth2/consent`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, scope: scopes, oauth_query: consentQuery }),
    }))
    expect(consentResponse.status).toBe(200)
    const consent = await consentResponse.json() as { url: string }
    const callback = new URL(consent.url)
    expect(callback.searchParams.get("state")).toBe("test-state")
    const tokenUrl = `${new URL(mcpResource).origin}/api/auth/oauth2/token`
    const token = await oauthProtocolRoutes.fetch(new Request(tokenUrl, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://dash.cloudflare.com", ...(proof && { DPoP: proof(tokenUrl) }) },
      body: new URLSearchParams({ client_id: client.client_id, grant_type: "authorization_code", code: callback.searchParams.get("code")!,
        redirect_uri: "https://client.test/callback", code_verifier: verifier, resource: mcpResource }),
    }))
    expect(token.status).toBe(200)
    expect(token.headers.get("access-control-allow-origin")).toBe("*")
    const payload = await token.json() as { access_token: string; refresh_token: string; token_type: string }
    expect(typeof payload.access_token).toBe("string")
    if (proof) expect(payload.token_type).toBe("DPoP")
    const principal = await principalFor(new Request(mcpResource, { headers: {
      authorization: `${proof ? "DPoP" : "Bearer"} ${payload.access_token}`,
      ...(proof && { DPoP: proof(mcpResource, payload.access_token) }),
    } }))
    return { clientId: client.client_id, principal, ...payload, code: callback.searchParams.get("code")!, verifier }
  }

  test("refresh rotates tokens, tolerates a lost response, and rejects late replay", async () => {
    const grant = await authorize(cookieA)
    const renew = (refreshToken: string) => auth.handler(new Request(`${new URL(mcpResource).origin}/api/auth/oauth2/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: grant.clientId, grant_type: "refresh_token", refresh_token: refreshToken, resource: mcpResource }),
    }))
    const response = await renew(grant.refresh_token)
    expect(response.status).toBe(200)
    const renewed = await response.json() as { access_token: string; refresh_token: string }
    expect(renewed.refresh_token).not.toBe(grant.refresh_token)
    expect((await principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${renewed.access_token}` } }))).appUserId).toBe(userA)
    const retried = await renew(grant.refresh_token)
    expect(retried.status).toBe(200)
    expect(await retried.json()).toEqual(renewed)
    await migrate.query(`update "oauthRefreshToken" set "rotationReplayExpiresAt" = now() - interval '1 second' where "clientId" = $1 and "rotatedAt" is not null`, [grant.clientId])
    expect((await renew(grant.refresh_token)).status).toBe(400)
    expect((await renew(renewed.refresh_token)).status).toBe(400)
  }, 15000)

  test("OAuth tokens discover and call tools over HTTP without a JWKS self-request", async () => {
    const grant = await authorize(cookieA)
    const app = new Hono().route("/api/mcp", mcpRoutes)
    const server = Bun.serve({ port: 0, fetch: app.fetch })
    const client = new McpClient({ name: "oauth-http-test", version: "1" })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", server.url), {
        requestInit: { headers: { authorization: `Bearer ${grant.access_token}` } },
      }))
      // A read grant lists 20 circles_* reads plus the 12 SDK reads Circles does not sync.
      expect((await client.listTools()).tools).toHaveLength(32)
      const result = await client.callTool({ name: "circles_list_people", arguments: {} })
      expect(result.isError).not.toBe(true)
      await expect(client.callTool({ name: "circles_create_person", arguments: { name: "Denied" } })).rejects.toThrow("not found")
      await mcpBrowserRoutes.request("/agents/revoke", { method: "POST", headers: { cookie: cookieA, "content-type": "application/json" }, body: JSON.stringify({ clientId: grant.clientId }) })
      const revoked = await fetch(new URL("/api/mcp", server.url), { headers: { authorization: `Bearer ${grant.access_token}` } })
      expect(revoked.status).toBe(401)
      expect(revoked.headers.get("www-authenticate")).toContain("resource_metadata")
    } finally { await client.close(); await server.stop(true) }
  }, 15000)

  test("an MCP client discovers OAuth, registers, signs in, consents and exchanges its callback", async () => {
    const app = new Hono().route("/", oauthProtocolRoutes).route("/api/mcp", mcpRoutes)
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    let registered: OAuthClientInformationMixed | undefined
    let tokens: OAuthTokens | undefined
    let verifier = ""
    let authorizationUrl = new URL(mcpResource)
    const state = "callback+state/with=reserved&characters"
    const provider: OAuthClientProvider = {
      redirectUrl: "https://client.test/callback",
      clientMetadata: { client_name: "Discovery test", redirect_uris: ["https://client.test/callback"],
        token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "circles:read offline_access" },
      state: () => state, clientInformation: () => registered, saveClientInformation: (value) => { registered = value },
      tokens: () => tokens, saveTokens: (value) => { tokens = value },
      redirectToAuthorization: (url) => { authorizationUrl = url },
      saveCodeVerifier: (value) => { verifier = value }, codeVerifier: () => verifier,
    }
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input, init))
    const options = { serverUrl: mcpResource, scope: "circles:read offline_access", fetchFn }
    expect(await clientAuth(provider, options)).toBe("REDIRECT")
    const login = await app.fetch(new Request(authorizationUrl))
    const loginUrl = new URL(login.headers.get("location")!, mcpResource)
    expect(loginUrl.pathname).toBe("/login")
    const resumed = await app.fetch(new Request(`${new URL(mcpResource).origin}/api/auth/oauth2/continue`, {
      method: "POST", headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ postLogin: true, oauth_query: loginUrl.search.slice(1) }),
    }))
    expect(resumed.status).toBe(200)
    const consentUrl = new URL((await resumed.json()).url, mcpResource)
    expect(consentUrl.pathname).toBe("/mcp/consent")
    const accepted = await app.fetch(new Request(`${new URL(mcpResource).origin}/api/auth/oauth2/consent`, {
      method: "POST", headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, scope: "circles:read offline_access", oauth_query: consentUrl.search.slice(1) }),
    }))
    expect(accepted.status).toBe(200)
    const callback = new URL((await accepted.json()).url)
    expect(callback.searchParams.get("state")).toBe(state)
    expect(await clientAuth(provider, { ...options, authorizationCode: callback.searchParams.get("code")! })).toBe("AUTHORIZED")
    expect(tokens?.refresh_token).toBeDefined()
    expect((await principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${tokens!.access_token}` } }))).appUserId).toBe(userA)
  }, 15000)

  test("expired tokens, wrong audiences, disabled clients and expired sessions are rejected", async () => {
    const grant = await authorize(cookieA)
    const claims = JSON.parse(Buffer.from(grant.access_token.split(".")[1]!, "base64url").toString())
    for (const payload of [ { ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, { ...claims, aud: "https://wrong.test/mcp" } ]) {
      const { token } = await auth.api.signJWT({ body: { payload } })
      const rejected = await mcpRoutes.request("/", { headers: { authorization: `Bearer ${token}` } })
      expect(rejected.status).toBe(401)
    }
    await migrate.query(`update "oauthClient" set disabled = true where "clientId" = $1`, [grant.clientId])
    await expect(principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${grant.access_token}` } }))).rejects.toThrow()
    await migrate.query(`update "oauthClient" set disabled = false where "clientId" = $1`, [grant.clientId])
    await migrate.query(`update session set "expiresAt" = now() - interval '1 second' where id = $1`, [claims.sid])
    try {
      await expect(principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${grant.access_token}` } }))).rejects.toThrow()
    } finally { await migrate.query(`update session set "expiresAt" = now() + interval '1 day' where id = $1`, [claims.sid]) }
  }, 15000)

  test("DPoP requires the bound key and rejects a reused proof", async () => {
    const proof = dpopSigner()
    const grant = await authorize(cookieA, undefined, proof)
    await expect(principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${grant.access_token}` } }))).rejects.toThrow()
    const headers = { authorization: `DPoP ${grant.access_token}`, DPoP: proof(mcpResource, grant.access_token) }
    expect((await principalFor(new Request(mcpResource, { headers }))).appUserId).toBe(userA)
    await expect(principalFor(new Request(mcpResource, { headers }))).rejects.toThrow()
    await expect(principalFor(new Request(mcpResource, { headers: {
      authorization: headers.authorization, DPoP: dpopSigner()(mcpResource, grant.access_token),
    } }))).rejects.toThrow()
  }, 15000)

  test("shared-session PKCE authorization preserves tenant and revocation is immediate", async () => {
    const grant = await authorize(cookieA)
    expect(grant.principal.appUserId).toBe(userA)
    expect(grant.principal.authUserId).toBe(authA)
    expect(grant.principal.scopes.has("circles:read")).toBe(true)
    const forged = await mcpBrowserRoutes.request("/consent?oauth_query=" + encodeURIComponent("client_id=bad&scope=circles:delete"), { headers: { cookie: cookieA } })
    expect(forged.status).toBe(400)
    await mcpBrowserRoutes.request("/agents/revoke", { method: "POST", headers: { cookie: cookieB, "content-type": "application/json" }, body: JSON.stringify({ clientId: grant.clientId }) })
    expect((await principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${grant.access_token}` } }))).appUserId).toBe(userA)
    const revoked = await mcpBrowserRoutes.request("/agents/revoke", { method: "POST", headers: { cookie: cookieA, "content-type": "application/json" }, body: JSON.stringify({ clientId: grant.clientId }) })
    expect(revoked.status).toBe(200)
    await expect(principalFor(new Request(mcpResource, { headers: { authorization: `Bearer ${grant.access_token}` } }))).rejects.toThrow()
  }, 15000)

  test("MCP operations reuse RLS, preserve response shapes and enforce write scopes", async () => {
    const scopes = new Set(["circles:read", "circles:organize"])
    const principal: McpPrincipal = { appUserId: userA, authUserId: authA, clientId: "test", issuedAt: 1, scopes }
    const client = new McpClient({ name: "circles-test", version: "1" })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpResource), { fetch: (input, init) => handleMcpRequest(new Request(input, init), principal) }))
      const created = await client.callTool({ name: "circles_create_person", arguments: { name: "MCP contact", notes: "Private CRM context" } })
      expect(created.isError).not.toBe(true)
      expect((await withTenant({ appUserId: userA }, (db) => listPeople(db))).map((p) => p.name)).toEqual(["MCP contact"])
      expect(await withTenant({ appUserId: userB }, (db) => listPeople(db))).toHaveLength(0)
      const listed = await client.callTool({ name: "circles_list_people", arguments: { limit: 1 } })
      expect((listed.structuredContent as any).data.nextOffset).toBe(1)
      await expect(client.callTool({ name: "circles_post_note_now", arguments: { clientRequestId: "test-request-1", bodyJson: { type: "doc", content: [] } } }))
        .rejects.toThrow("not found")
    } finally { await client.close() }
  })

  test("every MCP write tool runs end to end against a fake Substack", async () => {
    await migrate.query(`insert into substack_connections
        (id,user_id,generation,status,envelope_version,key_id,wrapped_key,iv,ciphertext,profile_id,profile_handle)
      values ('mcp-write-conn',$1,1,'active',1,'plain','plain','plain','session-a','4242','tester')`, [userA])
    await migrate.query(`insert into owned_content (id,user_id,connection_id,kind,external_id)
      values ('mcp-owned-note',$1,'mcp-write-conn','note','900')`, [userA])
    const substack = new FakeSubstack()
    globalThis.fetch = substack.handle as typeof fetch
    const principal: McpPrincipal = { appUserId: userA, authUserId: authA, clientId: "test", issuedAt: 1, scopes: new Set(MCP_SCOPES) }
    const client = new McpClient({ name: "write-tools-test", version: "1" })
    const called = new Set<string>()
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      called.add(name)
      const result = await client.callTool({ name, arguments: args })
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`)
      return (result.structuredContent as any).data
    }
    const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
    const later = (days: number) => new Date(Date.now() + days * 86400000).toISOString()
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpResource), { fetch: (input, init) => handleMcpRequest(new Request(input, init), principal) }))

      // CRM organize/delete: Circles-only rows.
      const { settings } = await run("circles_get_settings")
      await run("circles_update_settings", { priorityQueue: settings.priorityQueue })
      const { person } = await run("circles_create_person", { name: "MCP write test", handle: "mcp-write-test" })
      await run("circles_update_person", { personId: person.id, notes: "edited by MCP" })
      const { list } = await run("circles_create_list", { name: "MCP list" })
      await run("circles_update_list", { listId: list.id, name: "MCP list renamed" })
      await run("circles_add_list_member", { listId: list.id, personId: person.id })
      await run("circles_remove_list_member", { listId: list.id, personId: person.id })
      await run("circles_delete_list", { listId: list.id })
      const { tag } = await run("circles_create_contact_tag", { name: "MCP tag" })
      await run("circles_update_contact_tag", { tagId: tag.id, name: "MCP tag renamed", color: "#2563eb" })
      await run("circles_attach_contact_tag", { tagId: tag.id, personId: person.id })
      await run("circles_detach_contact_tag", { tagId: tag.id, personId: person.id })
      await run("circles_delete_contact_tag", { tagId: tag.id })
      await withTenant({ appUserId: userA }, (db) => recordInteraction(db, userA, {
        externalId: "mcp-comment", personId: person.id, connectionId: "mcp-write-conn", direction: "inbound",
        actionType: "comment", targetType: "note", targetId: "900", threadKind: "note", threadRootId: "900",
        occurredAt: new Date(Date.now() - 60000).toISOString(), body: "hello",
      }))
      const [comment] = (await run("circles_list_comments")).comments
      await run("circles_set_comment_not_interested", { id: comment.id, notInterested: true })
      await run("circles_set_comment_not_interested", { id: comment.id, notInterested: false })

      // Sync/import: queue jobs only; the worker is not run here.
      await run("circles_request_sync")
      await run("circles_sync_subscribers")
      await run("circles_refetch_person", { personId: person.id })
      const started = await run("circles_start_import", { streams: ["owned_notes"], days: 7 })
      await run("circles_pause_import", { id: started.importRunId })
      await run("circles_resume_import", { id: started.importRunId })
      await run("circles_cancel_import", { id: started.importRunId })
      await run("circles_archive_person", { personId: person.id })

      // Notes: every draft, schedule, publish, abort and delete path.
      const { image } = await run("circles_upload_note_image", {
        base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64") })
      const { tag: noteTag } = await run("circles_create_note_tag", { name: "MCP note tag" })
      await run("circles_update_note_tag", { tagId: noteTag.id, color: "#16a34a" })
      const { note: draft } = await run("circles_create_note_draft", {
        clientRequestId: "mcp-write-draft", bodyJson: doc("draft"), attachments: [{ type: "image", image }] })
      expect(draft.status).toBe("draft")
      await run("circles_update_note_draft", { id: draft.id, bodyJson: doc("draft edited") })
      expect((await run("circles_set_note_tags", { id: draft.id, tagIds: [noteTag.id] })).note.tags).toHaveLength(1)
      expect((await run("circles_reschedule_note", { id: draft.id, triggerAt: later(80) })).note.status).toBe("scheduled")
      expect((await run("circles_unschedule_note", { id: draft.id })).note.status).toBe("draft")
      expect((await run("circles_publish_existing_note", { id: draft.id })).note).toMatchObject({ status: "scheduled", postNow: true })
      expect((await run("circles_abort_note", { id: draft.id })).note).toMatchObject({ status: "draft", postNow: false })
      const { note: scheduled } = await run("circles_schedule_note", {
        clientRequestId: "mcp-write-scheduled", bodyJson: doc("scheduled"), triggerAt: later(80) })
      expect(scheduled.status).toBe("scheduled")
      const { note: now } = await run("circles_post_note_now", { clientRequestId: "mcp-write-now", bodyJson: doc("now") })
      expect(now).toMatchObject({ status: "scheduled", postNow: true })
      await run("circles_abort_note", { id: now.id })
      await run("circles_refresh_notes", { force: "1" })
      for (const id of [draft.id, scheduled.id, now.id]) await run("circles_delete_note", { id })
      await run("circles_delete_note_tag", { tagId: noteTag.id })

      // Nothing is left on the fake Substack, and nothing was published directly.
      expect(substack.drafts.size).toBe(0)
      expect(substack.requests.some((request) => request.includes("/comment/feed"))).toBe(false)
      const writes = [...circlesTools.filter((tool) => tool.method !== "GET").map((tool) => tool.name), "circles_upload_note_image"]
      expect(writes.filter((name) => !called.has(name))).toEqual([])
      const audited = await migrate.query("select action from audit_log where user_id = $1 and action like 'mcp.%'", [userA])
      expect(audited.rows.some((row) => row.action.startsWith("mcp.failed"))).toBe(false)
      expect(new Set(audited.rows.map((row) => row.action.replace("mcp.ok.", "")))).toEqual(new Set(writes.filter((name) => name !== "circles_upload_note_image")))
    } finally {
      await client.close()
      globalThis.fetch = originalFetch
    }
  }, 30000)

  test("SDK reads run through the worker, deduplicate and isolate their results", async () => {
    const grant = await authorize(cookieA)
    await connectSubstack()
    const one = await enqueueSdkTool(grant.principal, "get_authenticated_profile", {}, ["substack:read"])
    const two = await enqueueSdkTool(grant.principal, "get_authenticated_profile", {}, ["substack:read"])
    expect(one.runId).toBe(two.runId)
    const other = { ...grant.principal, appUserId: userB, authUserId: authB }
    await expect(getSdkRun(other, one.runId)).rejects.toThrow("not found")
    const { claimAndRunJob } = await import(new URL("../../worker/src/jobs.ts", import.meta.url).href)
    await withStubbedSubstackProfile(() => claimAndRunJob(db, "test-mcp-worker"))
    const run = await getSdkRun(grant.principal, one.runId)
    expect(run.status).toBe("done")
    expect(run.result.isError).not.toBe(true)
    expect(JSON.stringify(run.result)).toContain("Tester")
    expect(JSON.stringify(run.result)).not.toContain("synthetic-private-session")
    const second = await authorize(cookieA)
    const cached = await enqueueSdkTool(second.principal, "get_authenticated_profile", {}, ["substack:read"])
    expect(JSON.stringify((cached as { cached?: unknown }).cached)).toContain("Tester")
    // A refresh inside the cooldown still reuses the copy instead of hitting Substack.
    expect("cached" in await enqueueSdkTool(second.principal, "get_authenticated_profile", {}, ["substack:read"], true)).toBe(true)
  }, 15000)

  test("two agent clients cannot race past the account's ten-job limit", async () => {
    const first = await authorize(cookieA)
    const second = await authorize(cookieA)
    await connectSubstack()
    for (let index = 0; index < 9; index++)
      await enqueueSdkTool(first.principal, "get_notes", { cursor: `seed-${index}` }, ["substack:read"])
    const results = await Promise.allSettled([
      enqueueSdkTool(first.principal, "get_notes", { cursor: "first-client" }, ["substack:read"]),
      enqueueSdkTool(second.principal, "get_notes", { cursor: "second-client" }, ["substack:read"]),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected?.status === "rejected" && rejected.reason.message).toContain("Ten SDK reads")
    const count = await withTenant({ appUserId: userA }, async (client) => (await client.query("select count(*)::int as total from mcp_tool_runs")).rows[0].total)
    expect(count).toBe(10)
  }, 30000)

  test("Note time filters accept offsets and exclude the upper boundary", async () => {
    await connectSubstack()
    await migrate.query(`insert into scheduled_notes (id,user_id,connection_id,substack_draft_id,status,trigger_at)
      values ('inside',$1,'mcp-connection','1','scheduled','2026-10-14T08:00:00Z'),
             ('end',$1,'mcp-connection','2','scheduled','2026-10-14T09:00:00Z')`, [userA])
    const principal: McpPrincipal = { appUserId: userA, authUserId: authA, clientId: "test", issuedAt: 1, scopes: new Set(["circles:read"]) }
    const client = new McpClient({ name: "note-range-test", version: "1" })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpResource), { fetch: (input, init) => handleMcpRequest(new Request(input, init), principal) }))
      const result = await client.callTool({ name: "circles_list_notes", arguments: {
        status: "scheduled", from: "2026-10-14T10:00:00+03:00", to: "2026-10-14T12:00:00+03:00",
      } })
      expect(result.isError).not.toBe(true)
      expect((result.structuredContent as any).data.notes.map((note: { id: string }) => note.id)).toEqual(["inside"])
    } finally { await client.close() }
  })

  test("following and Note engagement are served from synced CRM data", async () => {
    const [followed] = await withTenant({ appUserId: userA }, async (client) => {
      const followed = await createPerson(client, userA, { name: "Followed", handle: "followed", isFollowing: true })
      const other = await createPerson(client, userA, { name: "Other", handle: "other" })
      const add = (externalId: string, personId: string, actionType: "like" | "restack" | "comment", threadRootId: string) =>
        recordInteraction(client, userA, { externalId, personId, direction: "inbound", actionType, targetType: "note",
          targetId: threadRootId, threadKind: "note", threadRootId, occurredAt: new Date().toISOString() })
      await add("note-like", followed.id, "like", "700")
      await add("note-restack", other.id, "restack", "700")
      await add("other-note", other.id, "comment", "701")
      return [followed]
    })
    const principal: McpPrincipal = { appUserId: userA, authUserId: authA, clientId: "test", issuedAt: 1, scopes: new Set(["circles:read"]) }
    const client = new McpClient({ name: "covered-reads-test", version: "1" })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpResource), { fetch: (input, init) => handleMcpRequest(new Request(input, init), principal) }))
      const engagement = (await client.callTool({ name: "circles_get_note_engagement", arguments: { noteId: "note:700" } })).structuredContent as any
      expect(engagement.data.counts).toEqual([
        { direction: "inbound", actionType: "like", total: 1 }, { direction: "inbound", actionType: "restack", total: 1 },
      ])
      const following = (await client.callTool({ name: "circles_list_people", arguments: { view: "following" } })).structuredContent as any
      expect(following.data.people.map((person: { id: string }) => person.id)).toEqual([followed.id])
    } finally { await client.close() }
  })
})
