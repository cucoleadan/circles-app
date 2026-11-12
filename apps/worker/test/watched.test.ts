import { afterEach, describe, expect, test } from "bun:test"
import { claimAndRunJob } from "../src/jobs.js"
import { fetchPublicationFeed, processWatchedProfiles, watchedDelaySeconds } from "../src/watched.js"

function queueWith(job: Record<string, unknown>) {
  const queries: { sql: string; params: any[] }[] = []
  const client: any = {
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params })
      return { rows: sql.includes("select id, type, payload") ? [job] : [], rowCount: 1 }
    },
    release: () => {},
  }
  return { pool: { connect: async () => client } as any, queries }
}
const watchedJob = {
  id: "job-w", type: "sync:watched", payload: { userId: "user-1", connectionId: "conn-1" }, attempts: 0, max_attempts: 5,
}
const nextWatched = (queries: { sql: string; params: any[] }[]) =>
  queries.filter((q) => q.sql.includes("insert into jobs") && q.sql.includes("select 'sync:watched'"))

describe("Watched Profiles schedule", () => {
  test("reads 10-20 seconds apart while members are due and idles about 5 minutes otherwise", () => {
    for (let i = 0; i < 200; i++) {
      const reading = watchedDelaySeconds(true)
      expect(reading).toBeGreaterThanOrEqual(10)
      expect(reading).toBeLessThanOrEqual(20)
      const idle = watchedDelaySeconds(false)
      expect(idle).toBeGreaterThanOrEqual(240)
      expect(idle).toBeLessThanOrEqual(360)
    }
  })

  test("queues the next profile 10-20 seconds after a read", async () => {
    const { pool, queries } = queueWith(watchedJob)
    await claimAndRunJob(pool, "worker", {
      onWatchedSync: async () => ({ skipped: false, watched: 120, fetched: 1, notes: 3, posts: 0 }),
    })
    const [next] = nextWatched(queries)
    expect(next).toBeDefined()
    expect(next!.sql).toContain("where not exists")
    expect(next!.params[3]).toBeGreaterThanOrEqual(10)
    expect(next!.params[3]).toBeLessThanOrEqual(20)
    const done = queries.find((q) => q.sql.includes("set status = 'done'"))
    expect(JSON.parse(done!.params[2])).toEqual({ watched: 120, fetched: 1, notes: 3, posts: 0 })
  })

  test("waits about 5 minutes when nobody is due", async () => {
    const { pool, queries } = queueWith(watchedJob)
    await claimAndRunJob(pool, "worker", { onWatchedSync: async () => ({ skipped: false, watched: 120, fetched: 0 }) })
    expect(nextWatched(queries)[0]!.params[3]).toBeGreaterThanOrEqual(240)
  })

  test("an empty list ends the chain", async () => {
    const { pool, queries } = queueWith(watchedJob)
    await claimAndRunJob(pool, "worker", { onWatchedSync: async () => ({ skipped: false, watched: 0, fetched: 0 }) })
    expect(nextWatched(queries)).toHaveLength(0)
  })

  test("a Substack challenge parks the whole chain instead of trying the next profile", async () => {
    const { pool, queries } = queueWith(watchedJob)
    await claimAndRunJob(pool, "worker", {
      onWatchedSync: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }) },
    })
    const parked = queries.find((q) => q.sql.includes("attempts = greatest(attempts - 1, 0)"))
    expect(parked).toBeDefined()
    expect(parked!.params[1]).toBeGreaterThanOrEqual(6 * 3600)
    expect(queries.some((q) => q.sql.includes("set status = 'expired'"))).toBe(false)
  })
})

describe("publication feed reads", () => {
  const respond = (status: number, body = "", headers: Record<string, string> = {}) =>
    new Response(status === 304 ? null : body, { status, headers })

  test("follows a redirect to the custom domain and returns the validators", async () => {
    const seen: string[] = []
    const fetcher = (async (input: any, init: any) => {
      seen.push(String(input))
      expect(init.redirect).toBe("manual")
      return seen.length === 1
        ? respond(301, "", { location: "https://www.writer.com/feed" })
        : respond(200, "<rss/>", { etag: '"abc"', "last-modified": "Mon, 02 Nov 2026 18:18:42 GMT" })
    }) as unknown as typeof fetch
    const result = await fetchPublicationFeed("https://writer.substack.com/feed", {}, fetcher)
    expect(seen).toEqual(["https://writer.substack.com/feed", "https://www.writer.com/feed"])
    expect(result).toMatchObject({ notModified: false, xml: "<rss/>", etag: '"abc"' })
  })

  test("refuses a redirect to a private address", async () => {
    const fetcher = (async () => respond(302, "", { location: "https://169.254.169.254/latest" })) as unknown as typeof fetch
    await expect(fetchPublicationFeed("https://writer.substack.com/feed", {}, fetcher)).rejects.toThrow("not a public https")
  })

  test("sends the stored validators and keeps them on 304", async () => {
    let headers: Record<string, string> = {}
    const fetcher = (async (_input: any, init: any) => { headers = init.headers; return respond(304) }) as unknown as typeof fetch
    const result = await fetchPublicationFeed("https://writer.substack.com/feed", { etag: '"abc"' }, fetcher)
    expect(headers["if-none-match"]).toBe('"abc"')
    expect(result).toEqual({ notModified: true, etag: '"abc"', lastModified: null })
  })
})

describe("processWatchedProfiles", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  function tenantClient(due: Record<string, unknown> | null) {
    const queries: { sql: string; params: any[] }[] = []
    const client: any = {
      query: async (sql: string, params: any[] = []) => {
        queries.push({ sql, params })
        if (sql.includes("from substack_connections")) return { rows: [{ key_id: "plain", ciphertext: "session", profile_id: "1", status: "active" }] }
        if (sql.includes("count(distinct p.id)")) return { rows: [{ total: 3 }] }
        if (sql.includes('as "postsDue"')) return { rows: due ? [due] : [] }
        if (sql.includes("insert into profile_content\n")) return { rows: [{ created: true }] }
        return { rows: [] }
      },
    }
    return { client, queries }
  }
  const due = {
    personId: "person-1", profileId: "4878855", publicationUrl: null, feedEtag: null, feedLastModified: null, postsDue: true,
    refreshDue: true, backfillCursor: null, backfillUntil: null, backfillDone: false,
  }
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  const notePage = (notes: Array<[id: number, days: number]>, nextCursor: string | null) => ({
    nextCursor,
    items: notes.map(([id, days]) => ({
      context: { type: "note", timestamp: daysAgo(days), users: [{ id: 4878855, handle: "tracy" }] },
      comment: { id, user_id: 4878855, handle: "tracy", body: `Note ${id}`, date: daysAgo(days) },
    })),
  })
  const feedPage = {
    items: [{
      context: { type: "note", timestamp: new Date().toISOString(), users: [{ id: 4878855, handle: "tracy", primary_publication: { subdomain: "secondact" } }] },
      comment: { id: 384, user_id: 4878855, handle: "tracy", body: "A Note", date: new Date().toISOString() },
    }],
  }

  test("does nothing when nobody is due", async () => {
    const { client } = tenantClient(null)
    globalThis.fetch = (async () => { throw new Error("no request expected") }) as unknown as typeof fetch
    expect(await processWatchedProfiles(client, "user-1", "conn-1")).toEqual({ skipped: false, watched: 3, fetched: 0, notes: 0, posts: 0 })
  })

  test("reads one profile feed with the session and the RSS feed without it", async () => {
    const { client, queries } = tenantClient(due)
    const substack: string[] = []
    globalThis.fetch = (async (input: any) => {
      substack.push(String(input instanceof Request ? input.url : input))
      return Response.json(feedPage)
    }) as unknown as typeof fetch
    const rss: { url: string; headers: Record<string, string> }[] = []
    const rssFetcher = (async (input: any, init: any) => {
      rss.push({ url: String(input), headers: init.headers })
      return new Response(`<rss><item><title>Hi</title><link>https://secondact.substack.com/p/hi</link></item></rss>`, { status: 200 })
    }) as unknown as typeof fetch

    const result = await processWatchedProfiles(client, "user-1", "conn-1", rssFetcher)
    expect(result).toEqual({ skipped: false, watched: 3, fetched: 1, notes: 1, posts: 1 })
    expect(substack).toHaveLength(1)
    expect(substack[0]).toContain("/reader/feed/profile/4878855")
    // The publication came from the feed page; the RSS request carries no cookie.
    expect(rss).toHaveLength(1)
    expect(rss[0]!.url).toBe("https://secondact.substack.com/feed")
    expect(JSON.stringify(rss[0]!.headers).toLowerCase()).not.toContain("cookie")
    const saved = queries.filter((q) => q.sql.includes("insert into profile_content\n"))
    expect(saved.map((q) => [q.params[4], q.params[5], q.params[10]])).toEqual([
      ["note", "c-384", "watched"], ["post", "secondact.substack.com/p/hi", "rss"],
    ])
  })

  const backlogUpdates = (queries: { sql: string; params: any[] }[]) =>
    queries.filter((q) => q.sql.includes("set backfill_cursor = $3")).map((q) => ({ cursor: q.params[2], done: q.params[4] }))
  const savedIds = (queries: { sql: string; params: any[] }[]) =>
    queries.filter((q) => q.sql.includes("insert into profile_content\n")).map((q) => q.params[5])

  test("the first read starts the backlog where its page ended and drops anything over 30 days old", async () => {
    const { client, queries } = tenantClient({ ...due, postsDue: false })
    globalThis.fetch = (async () => Response.json(notePage([[1, 0], [2, 3], [3, 45]], "page-2"))) as unknown as typeof fetch
    await processWatchedProfiles(client, "user-1", "conn-1")
    expect(savedIds(queries)).toEqual(["c-1", "c-2"])
    // The page already reached past 30 days, so there is nothing to walk back.
    expect(backlogUpdates(queries)).toEqual([{ cursor: null, done: true }])

    const recent = tenantClient({ ...due, postsDue: false })
    globalThis.fetch = (async () => Response.json(notePage([[1, 0], [2, 2]], "page-2"))) as unknown as typeof fetch
    await processWatchedProfiles(recent.client, "user-1", "conn-1")
    expect(backlogUpdates(recent.queries)).toEqual([{ cursor: "page-2", done: false }])
  })

  test("a backlog run walks back one 7-day batch and stops", async () => {
    const { client, queries } = tenantClient({
      ...due, refreshDue: false, backfillCursor: "page-2", backfillUntil: new Date(Date.now() - 2 * 86_400_000),
    })
    const pages: Record<string, unknown> = {
      "page-2": notePage([[10, 4], [11, 6]], "page-3"),
      "page-3": notePage([[12, 8], [13, 10]], "page-4"),
      "page-4": notePage([[14, 20]], "page-5"),
    }
    const cursors: string[] = []
    globalThis.fetch = (async (input: any) => {
      const cursor = new URL(String(input instanceof Request ? input.url : input)).searchParams.get("cursor")!
      cursors.push(cursor)
      return Response.json(pages[cursor])
    }) as unknown as typeof fetch
    const result = await processWatchedProfiles(client, "user-1", "conn-1", fetch, 0)
    // From 2 days back the batch covers to 9 days; page-3 reaches 10, so page-4 waits.
    expect(cursors).toEqual(["page-2", "page-3"])
    expect(savedIds(queries)).toEqual(["c-10", "c-11", "c-12", "c-13"])
    expect(backlogUpdates(queries).at(-1)).toEqual({ cursor: "page-4", done: false })
    expect(result).toMatchObject({ fetched: 1, posts: 0 })
    // A backlog run is not a refresh: the Notes checkpoint and RSS are untouched.
    expect(queries.some((q) => q.sql.includes("insert into profile_content_state"))).toBe(false)
  })

  test("the backlog ends at 30 days or when the feed runs out", async () => {
    const old = tenantClient({
      ...due, refreshDue: false, backfillCursor: "page-9", backfillUntil: new Date(Date.now() - 27 * 86_400_000),
    })
    globalThis.fetch = (async () => Response.json(notePage([[20, 29], [21, 33]], "page-10"))) as unknown as typeof fetch
    await processWatchedProfiles(old.client, "user-1", "conn-1", fetch, 0)
    expect(savedIds(old.queries)).toEqual(["c-20"])
    expect(backlogUpdates(old.queries)).toEqual([{ cursor: null, done: true }])

    const short = tenantClient({
      ...due, refreshDue: false, backfillCursor: "page-2", backfillUntil: new Date(Date.now() - 86_400_000),
    })
    globalThis.fetch = (async () => Response.json(notePage([[30, 2]], null))) as unknown as typeof fetch
    await processWatchedProfiles(short.client, "user-1", "conn-1", fetch, 0)
    expect(backlogUpdates(short.queries)).toEqual([{ cursor: null, done: true }])
  })

  test("records a failed profile and moves on, but rethrows a challenge", async () => {
    const missing = tenantClient(due)
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch
    expect(await processWatchedProfiles(missing.client, "user-1", "conn-1")).toMatchObject({ fetched: 1, notes: 0 })
    const state = missing.queries.find((q) => q.sql.includes("insert into profile_content_state"))
    expect(state!.params[6]).toBe("Profile feed request failed (404)")

    const challenged = tenantClient(due)
    globalThis.fetch = (async () => new Response("<html>challenge</html>", { status: 403 })) as unknown as typeof fetch
    await expect(processWatchedProfiles(challenged.client, "user-1", "conn-1")).rejects.toBeDefined()
    expect(challenged.queries.some((q) => q.sql.includes("insert into profile_content_state"))).toBe(false)
  })
})

describe("retention cleanup job", () => {
  const cleanupJob = { id: "job-c", type: "cleanup:retention", payload: { userId: "user-1", connectionId: "conn-1" }, attempts: 0, max_attempts: 5 }
  const queued = (queries: { sql: string; params: any[] }[]) =>
    queries.filter((q) => q.sql.includes("insert into jobs") && q.sql.includes("'cleanup:retention'"))

  test("continues in a follow-up job until nothing expired is left", async () => {
    const more = queueWith(cleanupJob)
    await claimAndRunJob(more.pool, "worker", {
      onRetentionCleanup: async () => ({ evidence: 5000, agentReads: 0, profileContent: 0, profileState: 0, completed: false }),
    })
    expect(queued(more.queries)).toHaveLength(1)
    const done = more.queries.find((q) => q.sql.includes("set status = 'done'"))
    expect(JSON.parse(done!.params[2])).toMatchObject({ evidence: 5000, completed: false })

    const finished = queueWith(cleanupJob)
    await claimAndRunJob(finished.pool, "worker", {
      onRetentionCleanup: async () => ({ evidence: 12, agentReads: 3, profileContent: 0, profileState: 0, completed: true }),
    })
    expect(queued(finished.queries)).toHaveLength(0)
  })

  test("deletes in batches inside the tenant and stops at its budget", async () => {
    const { processRetentionCleanup, EVIDENCE_RETENTION_DAYS } = await import("../src/retention.js")
    const statements: { sql: string; params: any[] }[] = []
    let tenant = ""
    const client: any = {
      query: async (sql: string, params: any[] = []) => {
        if (sql.includes("set_config")) tenant = params[0]
        if (!sql.startsWith("delete")) return { rows: [] }
        expect(tenant).toBe("user-1")
        statements.push({ sql, params })
        // Evidence never runs dry; every other table has 3 expired rows.
        return { rowCount: sql.includes("from ingestion_batches") ? params[0] : 3 }
      },
    }
    const result = await processRetentionCleanup(client, "user-1")
    expect(result).toEqual({ evidence: 25 * 200, agentReads: 3, profileContent: 3, profileState: 3, completed: false })
    expect(statements[0]!.params).toEqual([200, EVIDENCE_RETENTION_DAYS])
  })
})
