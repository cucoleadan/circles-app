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
  }
  const feedPage = {
    items: [{
      context: { type: "note", timestamp: "2026-11-11T23:09:00.142Z", users: [{ id: 4878855, handle: "tracy", primary_publication: { subdomain: "secondact" } }] },
      comment: { id: 384, user_id: 4878855, handle: "tracy", body: "A Note", date: "2026-11-11T23:09:00.142Z" },
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
