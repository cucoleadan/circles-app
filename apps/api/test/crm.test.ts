import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
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
import {
  applyFollowerSnapshot,
  applyFollowingSnapshot,
  ensurePerson,
  ingestActivityBatch,
  ingestConversationReplies,
  upsertSubscribersBatch,
  reconcileSubscriberSnapshot,
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
        body: JSON.stringify({
          months: 6,
          streams: [
            "activity", "outbound_actions", "owned_notes", "owned_posts",
            "subscribers", "followers",
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
      "activity", "outbound_actions", "owned_notes", "owned_posts", "subscribers", "followers",
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

  test("follower import preserves a new stable ID when its handle conflicts", async () => {
    await withTenant({ appUserId: userA }, (client) =>
      createPerson(client, userA, {
        name: "Original", handle: "@shared_handle", substackProfileId: "older-id",
      })
    )
    const result = await withTenant({ appUserId: userA }, (client) =>
      applyFollowerSnapshot(client, userA, [{
        id: "newer-id", name: "New person", handle: "shared_handle", isSubscribed: false,
      }])
    )
    expect(result.created).toBe(1)
    const people = await withTenant({ appUserId: userA }, (client) =>
      client.query("select substack_profile_id, handle, is_follower from people order by substack_profile_id")
    )
    expect(people.rows).toContainEqual(expect.objectContaining({
      substack_profile_id: "newer-id", handle: null, is_follower: true,
    }))
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

    const formerFollower = await withTenant({ appUserId: userA }, async (client) => {
      const p = await createPerson(client, userA, {
        name: "Former Follower",
        handle: "@former_follower",
        substackProfileId: "1110003",
      })
      await client.query("update people set is_follower = true where id = $1", [p.id])
      return p
    })
    const followerSnapshot = await withTenant({ appUserId: userA }, (client) =>
      applyFollowerSnapshot(client, userA, [
        { id: "1110001", handle: "follower_only", isSubscribed: false },
        {
          id: "1110004",
          handle: "imported_follower",
          name: "Imported Follower",
          photo_url: "https://example.com/imported.png",
          isSubscribed: false,
        },
      ])
    )
    expect(followerSnapshot.followers).toBe(2)
    expect(followerSnapshot.created).toBe(1)
    const importedFollower = await withTenant({ appUserId: userA }, async (client) => {
      const result = await client.query(
        "select id from people where substack_profile_id = $1",
        ["1110004"],
      )
      return result.rows[0]?.id ? getPerson(client, result.rows[0].id) : null
    })
    expect(importedFollower?.person.name).toBe("Imported Follower")
    expect(importedFollower?.person.handle).toBe("imported_follower")
    expect(importedFollower?.person.isFollower).toBe(true)
    const updatedFormerFollower = await withTenant({ appUserId: userA }, (client) =>
      getPerson(client, formerFollower.id)
    )
    expect(updatedFormerFollower?.person.isFollower).toBe(false)

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
  })
})
