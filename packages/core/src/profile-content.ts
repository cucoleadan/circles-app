import { randomUUID } from "node:crypto"
import type { PoolLike } from "./ingestion.js"

/**
 * Other people's Notes, restacks and posts (`profile_content`). The scheduled
 * watched-profiles job, on-demand agent reads and the public RSS feed all
 * normalize and store through this module.
 */
export type ProfileContentKind = "note" | "reply" | "restack" | "post"
export type ProfileContentSource = "watched" | "agent" | "rss"

export interface ProfileContentItem {
  kind: ProfileContentKind
  externalId: string
  title: string | null
  body: string | null
  url: string | null
  publishedAt: string | null
  raw: Record<string, unknown>
}

const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() :
  typeof value === "number" && Number.isFinite(value) ? String(value) : null
const isoDate = (value: unknown): string | null => {
  const raw = text(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Posts have no shared ID between the reader feed and RSS, so both key on the URL. */
export function postKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return null
  }
}

function publicationUrlOf(user: Record<string, any> | null): string | null {
  const subdomain = text(record(user?.primary_publication)?.subdomain)
  return subdomain && /^[a-z0-9-]+$/i.test(subdomain) ? `https://${subdomain.toLowerCase()}.substack.com` : null
}

/**
 * One page of Substack's profile feed (`reader/feed/profile/<id>`) as content
 * rows. Only what the profile authored or restacked is kept; likes, chat
 * prompts and any unknown item type are skipped.
 */
export function normalizeProfileFeed(page: unknown, profileId: string): {
  items: ProfileContentItem[]
  publicationUrl: string | null
} {
  const rawItems = Array.isArray(record(page)?.items) ? record(page)!.items as unknown[] : []
  const items: ProfileContentItem[] = []
  let publicationUrl: string | null = null
  for (const rawItem of rawItems) {
    const item = record(rawItem)
    const context = record(item?.context)
    if (!item || !context) continue
    const type = text(context.type)
    const users = Array.isArray(context.users) ? context.users.map(record) : []
    publicationUrl ??= publicationUrlOf(users.find((user) => text(user?.id) === profileId) ?? null)
    const comment = record(item.comment)
    const post = record(item.post)
    const rawContext = { type, timestamp: text(context.timestamp) }

    if (comment && (type === "note" || type === "comment_restack")) {
      const id = text(comment.id)
      if (!id) continue
      const authored = text(comment.user_id) === profileId
      // A Note in this feed that someone else wrote is a restack, whatever its label.
      const restack = type === "comment_restack" || !authored
      const handle = text(comment.handle) ?? (authored ? text(users[0]?.handle) : null)
      items.push({
        kind: restack ? "restack" : text(comment.ancestor_path) ? "reply" : "note",
        externalId: `c-${id}`,
        title: null,
        body: text(comment.body),
        url: handle ? `https://substack.com/@${handle}/note/c-${id}` : null,
        publishedAt: isoDate(restack ? context.timestamp ?? comment.date : comment.date ?? context.timestamp),
        raw: { context: rawContext, comment },
      })
    } else if (post && (type === "post" || type === "latest_post" || type === "post_restack")) {
      const url = text(post.canonical_url)
      const restack = type === "post_restack"
      const externalId = restack ? (text(post.id) ? `p-${text(post.id)}` : null) : url ? postKey(url) : null
      if (!externalId) continue
      items.push({
        kind: restack ? "restack" : "post",
        externalId,
        title: text(post.title),
        body: text(post.subtitle) ?? text(post.description) ?? text(post.truncated_body_text),
        url,
        publishedAt: isoDate(restack ? context.timestamp ?? post.post_date : post.post_date ?? context.timestamp),
        raw: { context: rawContext, post },
      })
    }
  }
  return { items, publicationUrl }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? match
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

function rssField(item: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(item)
  if (!match) return null
  const inner = match[1]!.trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner)
  return (cdata ? cdata[1]! : decodeEntities(inner)).trim() || null
}

const RSS_BODY_LIMIT = 2000

/** Posts from a publication's public RSS feed. Substack lists about the 20 newest. */
export function parseRssFeed(xml: string): ProfileContentItem[] {
  const items: ProfileContentItem[] = []
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1]!
    const url = rssField(item, "link")
    const externalId = url ? postKey(url) : null
    if (!url || !externalId || !/^https:\/\//i.test(url)) continue
    const description = rssField(item, "description")
    const body = description
      ? decodeEntities(description.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, RSS_BODY_LIMIT) || null
      : null
    const title = rssField(item, "title")
    const publishedAt = isoDate(rssField(item, "pubDate"))
    items.push({
      kind: "post",
      externalId,
      title,
      body,
      url,
      publishedAt,
      raw: { rss: { title, link: url, pubDate: publishedAt, creator: rssField(item, "dc:creator") } },
    })
  }
  return items
}

/**
 * The feed URL for a stored publication URL, or null when it is not a public
 * https host. Contact fields are editable, so this refuses anything that could
 * point the worker at a private address.
 */
export function publicationFeedUrl(publicationUrl: string | null | undefined): string | null {
  if (!publicationUrl) return null
  let parsed: URL
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(publicationUrl) ? publicationUrl : `https://${publicationUrl}`)
  } catch {
    return null
  }
  return isPublicHttpsUrl(parsed) ? `${parsed.origin}/feed` : null
}

export function isPublicHttpsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return url.protocol === "https:" && !url.username && !url.password && (url.port === "" || url.port === "443") &&
    host.includes(".") && !host.includes(":") && !/^[\d.]+$/.test(host) &&
    !/(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(host)
}

async function contactFor(client: PoolLike, userId: string, profileId: string): Promise<string | null> {
  return (await client.query(
    `select id from people where user_id = $1 and substack_profile_id = $2
     order by (archived_at is null) desc, created_at limit 1`,
    [userId, profileId],
  )).rows[0]?.id ?? null
}

/** Upserts content rows for one profile inside the caller's tenant transaction. */
export async function saveProfileContent(client: PoolLike, input: {
  userId: string
  profileId: string
  items: ProfileContentItem[]
  source: ProfileContentSource
}): Promise<{ stored: number; created: number; personId: string | null }> {
  const personId = await contactFor(client, input.userId, input.profileId)
  let created = 0
  for (const item of input.items) {
    const result = await client.query(
      `insert into profile_content
         (id, user_id, substack_profile_id, person_id, kind, external_id, title, body, url, published_at, source, raw)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       on conflict (user_id, substack_profile_id, kind, external_id) do update set
         person_id = coalesce(excluded.person_id, profile_content.person_id),
         title = coalesce(excluded.title, profile_content.title),
         body = coalesce(excluded.body, profile_content.body),
         url = coalesce(excluded.url, profile_content.url),
         published_at = coalesce(excluded.published_at, profile_content.published_at),
         raw = profile_content.raw || excluded.raw,
         updated_at = now()
       returning (xmax = 0) as created`,
      [
        randomUUID(), input.userId, input.profileId, personId, item.kind, item.externalId,
        item.title, item.body, item.url, item.publishedAt, input.source, JSON.stringify(item.raw),
      ],
    )
    if (result.rows[0]?.created) created++
  }
  return { stored: input.items.length, created, personId }
}

/** Records a Notes or posts fetch attempt for one profile. */
export async function recordProfileContentFetch(client: PoolLike, input: {
  userId: string
  profileId: string
  personId?: string | null
  stream: "notes" | "posts"
  error?: string | null
  publicationUrl?: string | null
  /** Only for posts: validators for the next conditional RSS request. */
  feedEtag?: string | null
  feedLastModified?: string | null
}) {
  const ok = !input.error
  const personId = input.personId === undefined
    ? await contactFor(client, input.userId, input.profileId)
    : input.personId
  await client.query(
    `insert into profile_content_state as s
       (user_id, substack_profile_id, person_id, publication_url,
        notes_checked_at, notes_fetched_at, notes_error,
        posts_checked_at, posts_fetched_at, posts_error, feed_etag, feed_last_modified)
     values ($1, $2, $3, $4::text,
       case when $5::text = 'notes' then now() end, case when $5::text = 'notes' and $6::boolean then now() end,
       case when $5::text = 'notes' then $7::text end,
       case when $5::text = 'posts' then now() end, case when $5::text = 'posts' and $6::boolean then now() end,
       case when $5::text = 'posts' then $7::text end, $8::text, $9::text)
     on conflict (user_id, substack_profile_id) do update set
       person_id = coalesce(excluded.person_id, s.person_id),
       publication_url = coalesce(excluded.publication_url, s.publication_url),
       notes_checked_at = coalesce(excluded.notes_checked_at, s.notes_checked_at),
       notes_fetched_at = coalesce(excluded.notes_fetched_at, s.notes_fetched_at),
       notes_error = case when $5::text = 'notes' then excluded.notes_error else s.notes_error end,
       posts_checked_at = coalesce(excluded.posts_checked_at, s.posts_checked_at),
       posts_fetched_at = coalesce(excluded.posts_fetched_at, s.posts_fetched_at),
       posts_error = case when $5::text = 'posts' then excluded.posts_error else s.posts_error end,
       feed_etag = case when $5::text = 'posts' and $6::boolean then excluded.feed_etag else s.feed_etag end,
       feed_last_modified = case when $5::text = 'posts' and $6::boolean then excluded.feed_last_modified else s.feed_last_modified end,
       updated_at = now()`,
    [
      input.userId, input.profileId, personId, input.publicationUrl ?? null,
      input.stream, ok, input.error ?? null, input.feedEtag ?? null, input.feedLastModified ?? null,
    ],
  )
}
