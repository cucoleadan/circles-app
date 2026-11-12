import type { PoolClient } from "pg"
import {
  createSubstackClient,
  isPublicHttpsUrl,
  normalizeProfileFeed,
  openSessionToken,
  parseRssFeed,
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

/**
 * Refreshes the most overdue member of the Watched Profiles list: one
 * authenticated profile-feed page (Notes and restacks) and, at most daily, the
 * publication's RSS feed (posts). A profile that fails is recorded and skipped
 * until its next turn; only a Substack challenge or rate limit is rethrown, so
 * the queue pauses the whole chain instead of moving on to the next profile.
 */
export async function processWatchedProfiles(
  client: PoolClient,
  userId: string,
  connectionId: string,
  fetcher: typeof fetch = fetch,
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
         (s.posts_checked_at is null or s.posts_checked_at < now() - make_interval(secs => $2)) as "postsDue"
       ${WATCHED_MEMBERS}
       left join profile_content_state s
         on s.user_id = p.user_id and s.substack_profile_id = p.substack_profile_id
       where p.substack_profile_id <> coalesce($3, '')
         and (s.notes_checked_at is null or s.notes_checked_at < now() - make_interval(secs => $1))
       order by s.notes_checked_at nulls first, lm.created_at, p.id
       limit 1`,
      [WATCHED_NOTES_INTERVAL_SECONDS, WATCHED_POSTS_INTERVAL_SECONDS, conn.profile_id],
    )).rows[0] as {
      personId: string; profileId: string; publicationUrl: string | null
      feedEtag: string | null; feedLastModified: string | null; postsDue: boolean
    } | undefined
    return { conn, watched, due }
  })
  if (!picked) return { skipped: true as const }
  const { conn, watched, due } = picked
  if (!due) return { skipped: false as const, watched, fetched: 0, notes: 0, posts: 0 }

  const base = { userId, profileId: due.profileId, personId: due.personId }
  let feed: ReturnType<typeof normalizeProfileFeed>
  try {
    const sdk = createSubstackClient({ sessionToken: openSessionToken(conn), publicationUrl: conn.publication_url })
    // The global reader feed: works for any profile, with or without a publication.
    feed = normalizeProfileFeed(await sdk.getProfileFeed(due.profileId), due.profileId)
  } catch (error: any) {
    const status = statusOf(error)
    if (status === 403 || status === 429) throw error
    // Never store upstream error text: it can echo request details.
    await withTenant(client, userId, () => recordProfileContentFetch(client, {
      ...base, stream: "notes", error: `Profile feed request failed${status ? ` (${status})` : ""}`,
    }))
    return { skipped: false as const, watched, fetched: 1, notes: 0, posts: 0 }
  }
  const notes = await withTenant(client, userId, async () => {
    const saved = await saveProfileContent(client, { userId, profileId: due.profileId, items: feed.items, source: "watched" })
    await recordProfileContentFetch(client, { ...base, stream: "notes", publicationUrl: feed.publicationUrl })
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
      const items = rss && !rss.notModified ? parseRssFeed(rss.xml ?? "") : []
      const saved = await saveProfileContent(client, { userId, profileId: due.profileId, items, source: "rss" })
      await recordProfileContentFetch(client, {
        ...base, stream: "posts", error: failure, feedEtag: rss?.etag, feedLastModified: rss?.lastModified,
      })
      return saved.created
    })
  }
  return { skipped: false as const, watched, fetched: 1, notes, posts }
}
