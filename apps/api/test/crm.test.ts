import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
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
} from "../src/db/repositories.js"
import { withTenant } from "../src/db/tenant.js"
import {
  ingestActivityBatch,
  ingestConversationReplies,
} from "@workspace/core"
import { ext } from "../src/routes/ext.js"

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
})

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
    import_runs, ingestion_batches, audit_log, jobs
    restart identity cascade`)
})

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

    await expect(
      withTenant({ appUserId: userB }, (client) =>
        attachTag(client, userB, tag.id, person.id)
      )
    ).rejects.toMatchObject({ code: "23503" })
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
    await expect(
      withTenant({ appUserId: userA }, (client) =>
        createPerson(client, userA, { name: "Alice 2", handle: "alice" })
      )
    ).rejects.toMatchObject({ code: "23505" })
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
  test("dedupe by external id and cursor pagination stay consistent", async () => {
    const person = await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, { name: "Alice", handle: "@alice" })
    )

    await withTenant({ appUserId: userA }, async (client) => {
      const first = await recordInteraction(client, userA, {
        externalId: "evt-0",
        personId: person.id,
        direction: "inbound",
        actionType: "comment",
        occurredAt: new Date("2026-09-01T10:00:00Z").toISOString(),
      })
      expect(first).not.toBeNull()

      const duplicate = await recordInteraction(client, userA, {
        externalId: "evt-0",
        personId: person.id,
        direction: "inbound",
        actionType: "comment",
        occurredAt: new Date("2026-09-01T10:00:00Z").toISOString(),
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
            Date.parse("2026-09-01T10:00:00Z") + i * 60_000
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
    expect(stats.newInteractions).toBe(3)

    const people = await withTenant({ appUserId: userA }, (client) =>
      listPeople(client, { search: "carol" })
    )
    expect(people).toHaveLength(1)
    const carol = people[0]
    expect(carol.interactionCount).toBe(2) // 2 comments from Carol (owner reply is outbound, not on Carol)
    expect(carol.conversationCount).toBe(1) // 1 thread root
    expect(carol.engagementScore).toBe(6) // 3 + 3 = 6
  })

  test("GET /companion returns lists and handles for connected user", async () => {
    // create session for authA
    await migrate.query(
      `insert into session (id, "userId", token, "expiresAt", "createdAt", "updatedAt") values
         ('sess-a', $1, 'test-token-a', now() + interval '1 day', now(), now())
       on conflict (id) do nothing`,
      [authA]
    )

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
          cookie: "better-auth.session_token=test-token-a",
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
          cookie: "better-auth.session_token=test-token-a",
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
          cookie: "better-auth.session_token=test-token-a",
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
})

