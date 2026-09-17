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
import { v1 } from "../src/routes/v1.js"

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

  beforeAll(async () => {
    const { makeSignature } = await import("better-auth/crypto")
    const token = "test-token-a"
    const sig = await makeSignature(token, process.env.BETTER_AUTH_SECRET!)
    signedCookieA = `better-auth.session_token=${encodeURIComponent(token)}.${sig}`

    await migrate.query(
      `insert into session (id, "userId", token, "expiresAt", "createdAt", "updatedAt") values
         ('sess-a', $1, $2, now() + interval '1 day', now(), now())
       on conflict (id) do nothing`,
      [authA, token]
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
    const connectRes = await ext.fetch(
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
    )
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

  test("connection, sync with cooldown, and import runs lifecycle via v1 API", async () => {
    // 1. POST /connection
    const connRes = await v1.fetch(
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
    )
    expect(connRes.status).toBe(201)
    const connBody = (await connRes.json()) as any
    expect(connBody.connection.id).toBeDefined()

    // 2. GET /connection
    const getConnRes = await v1.fetch(
      new Request("http://localhost:3000/connection", {
        headers: { cookie: signedCookieA },
      })
    )
    expect(getConnRes.status).toBe(200)
    const getConnBody = (await getConnRes.json()) as any
    expect(getConnBody.connection.id).toBe(connBody.connection.id)

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
        body: JSON.stringify({ months: 6 }),
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
})
