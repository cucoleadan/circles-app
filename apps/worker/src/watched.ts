import type { PoolClient } from "pg"
import {
  createSubstackClient,
  isPublicHttpsUrl,
  normalizeProfileFeed,
  openSessionToken,
  parseRssFeed,
  type ProfileContentItem,
  publicationFeedUrl,
  recordProfileContentFetch,
  saveProfileContent,
} from "@workspace/core"
import { withTenant } from "./tenant.js"

/** A watched profile's Notes are re-read this often; its posts (public RSS) daily. */
export const WATCHED_NOTES_INTERVAL_SECONDS = 6 * 60 * 60
export const WATCHED_POSTS_INTERVAL_SECONDS = 24 * 60 * 60
/** While members are due, one profile is read every 10-20 seconds. */
const WATCHED_READ_GAP_SECONDS = [10, 20] as const
/** With nobody due, the chain only checks the list, so a new member is read soon. */
const WATCHED_IDLE_GAP_SECONDS = 5 * 60
const RSS_MAX_BYTES = 5 * 1024 * 1024

/** Seconds until the chain's next run: a random 10-20 s after a read, about 5 min when idle. */
export function watchedDelaySeconds(fetched: boolean) {
  const [min, max] = WATCHED_READ_GAP_SECONDS
  return fetched
    ? Math.round(min + Math.random() * (max - min))
    : Math.round(WATCHED_IDLE_GAP_SECONDS * (0.8 + Math.random() * 0.4))
}

const WATCHED_MEMBERS = `
  from list_members lm
  join lists l on l.id = lm.list_id and l.system_key = 'watched'
  join people p on p.id = lm.person_id and p.archived_at is null and p.substack_profile_id is not null`

const statusOf = (error: any): number | null =>
  Number(error?.status ?? error?.statusCode) || Number(/\b(4\d\d|5\d\d)\b/.exec(String(error?.message ?? ""))?.[1]) || null

export interface RssResult {
  notModified: boolean
  xml?: string
  etag: string | null
  lastModified: string | null
}

/**
 * Reads a publication's public RSS feed without the Substack session. Redirects
 * (a substack.com subdomain forwarding to its custom domain) are followed only
 * to other public https hosts.
 */
export async function fetchPublicationFeed(
  feedUrl: string,
  validators: { etag?: string | null; lastModified?: string | null },
  fetcher: typeof fetch = fetch,
): Promise<RssResult> {
  let url = new URL(feedUrl)
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublicHttpsUrl(url)) throw new Error("Feed URL is not a public https address")
    const response = await fetcher(url, {
      redirect: "manual",
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        ...(validators.etag && { "if-none-match": validators.etag }),
        ...(validators.lastModified && { "if-modified-since": validators.lastModified }),
      },
    })
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location")
      if (!location) throw new Error("Feed redirect had no location")
      url = new URL(location, url)
      continue
    }
    if (response.status === 304)
      return { notModified: true, etag: validators.etag ?? null, lastModified: validators.lastModified ?? null }
    if (!response.ok) throw new Error(`Feed request failed (${response.status})`)
    const xml = await response.text()
    if (xml.length > RSS_MAX_BYTES) throw new Error("Feed is too large")
    return {
      notModified: false,
      xml,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    }
  }
  throw new Error("Feed redirected too many times")
}

/** Backlog kept for a watched contact, and how much of it one run reads. */
export const WATCHED_BACKLOG_DAYS = 30
export const WATCHED_BATCH_DAYS = 7
/** A run stops after this many backlog pages even if its 7 days are not covered. */
const BACKLOG_MAX_PAGES = 6
const BACKLOG_PAGE_PAUSE_MS = 2500
const DAY_MS = 24 * 60 * 60 * 1000

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const NOTE_KINDS = new Set(["note", "reply", "restack"])

/** The oldest Note-like item on a page; posts are pinned out of order, so they do not count. */
function oldestNoteTime(items: ProfileContentItem[]): number | null {
  const times = items.filter((item) => NOTE_KINDS.has(item.kind) && item.publishedAt).map((item) => Date.parse(item.publishedAt!))
  return times.length ? Math.min(...times) : null
}

const withinBacklog = (items: ProfileContentItem[], cutoff: number) =>
  items.filter((item) => !item.publishedAt || Date.parse(item.publishedAt) >= cutoff)

interface DueProfile {
  personId: string
  profileId: string
  publicationUrl: string | null
  feedEtag: string | null
  feedLastModified: string | null
  postsDue: boolean
  refreshDue: boolean
  backfillCursor: string | null
  backfillUntil: Date | null
  backfillDone: boolean | null
}

/**
 * Serves the member of the Watched Profiles list that has waited longest.
 * A refresh reads the newest profile-feed page (Notes, replies, restacks) and,
 * at most daily, the publication's RSS feed (posts). A contact whose backlog is
 * not complete gets backlog runs in between: each walks the feed back another
 * 7 days, until 30 days are held. Nothing older than 30 days is stored.
 * A profile that fails is recorded and skipped until its next turn; only a
 * Substack challenge or rate limit is rethrown, so the queue pauses the whole
 * chain instead of moving on to the next profile.
 */
export async function processWatchedProfiles(
  client: PoolClient,
  userId: string,
  connectionId: string,
  fetcher: typeof fetch = fetch,
  pagePauseMs = BACKLOG_PAGE_PAUSE_MS,
) {
  const picked = await withTenant(client, userId, async () => {
    const conn = (await client.query(
      `select key_id, iv, ciphertext, publication_url, profile_id, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )).rows[0]
    if (!conn || conn.status !== "active") return null
    const watched = Number((await client.query(`select count(distinct p.id)::int as total ${WATCHED_MEMBERS}`)).rows[0]?.total ?? 0)
    const due = (await client.query(
      `select p.id as "personId", p.substack_profile_id as "profileId",
         coalesce(nullif(p.publication_url, ''), s.publication_url) as "publicationUrl",
         s.feed_etag as "feedEtag", s.feed_last_modified as "feedLastModified",
         (s.posts_checked_at is null or s.posts_checked_at < now() - make_interval(secs => $2)) as "postsDue",
         (s.notes_checked_at is null or s.notes_checked_at < now() - make_interval(secs => $1)) as "refreshDue",
         s.backfill_cursor as "backfillCursor", s.backfill_until as "backfillUntil", s.backfill_done as "backfillDone"
       ${WATCHED_MEMBERS}
       left join profile_content_state s
         on s.user_id = p.user_id and s.substack_profile_id = p.substack_profile_id
       where p.substack_profile_id <> coalesce($3, '')
         and (s.notes_checked_at is null or s.notes_checked_at < now() - make_interval(secs => $1)
           or (not s.backfill_done and s.backfill_cursor is not null))
       order by greatest(s.notes_checked_at, s.backfill_checked_at) nulls first, lm.created_at, p.id
       limit 1`,
      [WATCHED_NOTES_INTERVAL_SECONDS, WATCHED_POSTS_INTERVAL_SECONDS, conn.profile_id],
    )).rows[0] as DueProfile | undefined
    return { conn, watched, due }
  })
  if (!picked) return { skipped: true as const }
  const { conn, watched, due } = picked
  if (!due) return { skipped: false as const, watched, fetched: 0, notes: 0, posts: 0 }

  const base = { userId, profileId: due.profileId, personId: due.personId }
  const cutoff = Date.now() - WATCHED_BACKLOG_DAYS * DAY_MS
  const sdk = createSubstackClient({ sessionToken: openSessionToken(conn), publicationUrl: conn.publication_url })
  // The global reader feed: works for any profile, with or without a publication.
  const readPage = async (cursor?: string) => {
    const page: any = await sdk.getProfileFeed(due.profileId, cursor ? { cursor } : undefined)
    const nextCursor = typeof page?.nextCursor === "string" && page.nextCursor ? page.nextCursor as string : null
    return { feed: normalizeProfileFeed(page, due.profileId), nextCursor }
  }
  const saveBacklog = (state: { cursor: string | null; until: number | null; done: boolean }) => client.query(
    `update profile_content_state
     set backfill_cursor = $3, backfill_until = coalesce(to_timestamp($4::double precision / 1000), backfill_until),
         backfill_done = $5, backfill_checked_at = now(), updated_at = now()
     where user_id = $1 and substack_profile_id = $2`,
    [userId, due.profileId, state.done ? null : state.cursor, state.until, state.done],
  )

  if (!due.refreshDue) {
    // Backlog run: continue from the stored position for another 7 days.
    const from = due.backfillUntil ? due.backfillUntil.getTime() : Date.now()
    const target = Math.max(cutoff, from - WATCHED_BATCH_DAYS * DAY_MS)
    let cursor = due.backfillCursor
    let until: number | null = null
    let created = 0
    try {
      for (let pages = 0; cursor && pages < BACKLOG_MAX_PAGES; pages++) {
        if (pages > 0) await pause(pagePauseMs)
        const { feed, nextCursor } = await readPage(cursor)
        const oldest = oldestNoteTime(feed.items)
        created += await withTenant(client, userId, async () => {
          const saved = await saveProfileContent(client, {
            userId, profileId: due.profileId, items: withinBacklog(feed.items, cutoff), source: "watched",
          })
          cursor = nextCursor
          if (oldest !== null) until = Math.min(until ?? oldest, oldest)
          await saveBacklog({ cursor, until, done: !cursor || (until !== null && until <= cutoff) })
          return saved.created
        })
        if (until !== null && until <= target) break
      }
    } catch (error: any) {
      const status = statusOf(error)
      if (status === 403 || status === 429) throw error
      // The position is kept; mark the attempt so other profiles get their turn.
      await withTenant(client, userId, () => client.query(
        `update profile_content_state set backfill_checked_at = now(), notes_error = $3, updated_at = now()
         where user_id = $1 and substack_profile_id = $2`,
        [userId, due.profileId, `Backlog request failed${status ? ` (${status})` : ""}`],
      ))
    }
    return { skipped: false as const, watched, fetched: 1, notes: created, posts: 0 }
  }

  let first: Awaited<ReturnType<typeof readPage>>
  try {
    first = await readPage()
  } catch (error: any) {
    const status = statusOf(error)
    if (status === 403 || status === 429) throw error
    // Never store upstream error text: it can echo request details.
    await withTenant(client, userId, () => recordProfileContentFetch(client, {
      ...base, stream: "notes", error: `Profile feed request failed${status ? ` (${status})` : ""}`,
    }))
    return { skipped: false as const, watched, fetched: 1, notes: 0, posts: 0 }
  }
  const { feed } = first
  const notes = await withTenant(client, userId, async () => {
    const saved = await saveProfileContent(client, {
      userId, profileId: due.profileId, items: withinBacklog(feed.items, cutoff), source: "watched",
    })
    await recordProfileContentFetch(client, { ...base, stream: "notes", publicationUrl: feed.publicationUrl })
    // First read of this contact: the backlog starts where this page ended.
    if (!due.backfillDone && !due.backfillCursor) {
      const oldest = oldestNoteTime(feed.items)
      await saveBacklog({
        cursor: first.nextCursor, until: oldest, done: !first.nextCursor || (oldest !== null && oldest <= cutoff),
      })
    }
    return saved.created
  })

  let posts = 0
  if (due.postsDue) {
    let rss: RssResult | null = null
    let failure: string | null = null
    try {
      const feedUrl = publicationFeedUrl(due.publicationUrl ?? feed.publicationUrl)
      if (!feedUrl) throw new Error("No publication URL is known for this profile")
      rss = await fetchPublicationFeed(feedUrl, { etag: due.feedEtag, lastModified: due.feedLastModified }, fetcher)
    } catch (error: any) {
      // RSS is public and optional; a failure waits for tomorrow's attempt.
      failure = String(error?.message ?? "Feed request failed").slice(0, 200)
    }
    posts = await withTenant(client, userId, async () => {
      const items = rss && !rss.notModified ? withinBacklog(parseRssFeed(rss.xml ?? ""), cutoff) : []
      const saved = await saveProfileContent(client, { userId, profileId: due.profileId, items, source: "rss" })
      await recordProfileContentFetch(client, {
        ...base, stream: "posts", error: failure, feedEtag: rss?.etag, feedLastModified: rss?.lastModified,
      })
      return saved.created
    })
  }
  return { skipped: false as const, watched, fetched: 1, notes, posts }
}
