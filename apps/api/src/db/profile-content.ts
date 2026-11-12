import { PROFILE_CONTENT_MAX_DAYS } from "@workspace/core"
import type { PoolLike } from "./repositories.js"

export interface ProfileContentOptions {
  personId?: string
  listId?: string
  kind: "all" | "note" | "reply" | "restack" | "post"
  since?: string
  until?: string
  limit: number
  cursor?: string
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    return typeof value?.at === "string" && !Number.isNaN(Date.parse(value.at)) && typeof value?.id === "string"
      ? value : null
  } catch {
    return null
  }
}

const PROFILE_LIMIT = 500

/**
 * Stored Notes, replies, restacks and posts for one contact, a list's members,
 * or (by default) the built-in Watched Profiles list. Reads only the local
 * copy, and only its last 30 days; `profiles` says how fresh that copy is for
 * each contact in scope.
 */
export async function listProfileContent(client: PoolLike, options: ProfileContentOptions) {
  const cursor = options.cursor ? decodeCursor(options.cursor) : null
  if (options.cursor && !cursor) throw new Error("Invalid cursor")
  // $1 person, $2 list: both null selects the Watched Profiles list.
  const scope = `
    select p.id, p.name, p.handle, p.substack_profile_id, p.user_id
    from people p
    where p.archived_at is null and p.substack_profile_id is not null
      and case
        when $1::text is not null then p.id = $1
        else exists (
          select 1 from list_members lm join lists l on l.id = lm.list_id
          where lm.person_id = p.id
            and case when $2::text is not null and $2 <> 'watched' then l.id = $2 else l.system_key = 'watched' end
        )
      end`
  const scopeParams = [options.personId ?? null, options.listId ?? null]
  const items = await client.query(
    `with scope as (${scope})
     select c.id, c.kind, c.title, c.body, c.url, c.source,
       coalesce(c.published_at, c.created_at) as "publishedAt",
       c.substack_profile_id as "profileId", s.id as "personId", s.name, s.handle
     from profile_content c
     join scope s on s.user_id = c.user_id and s.substack_profile_id = c.substack_profile_id
     where ($3::text = 'all' or c.kind = $3)
       and coalesce(c.published_at, c.created_at) >= now() - make_interval(days => $9)
       and ($4::timestamptz is null or coalesce(c.published_at, c.created_at) >= $4)
       and ($5::timestamptz is null or coalesce(c.published_at, c.created_at) < $5)
       and ($6::timestamptz is null or (coalesce(c.published_at, c.created_at), c.id) < ($6, $7::text))
     order by coalesce(c.published_at, c.created_at) desc, c.id desc
     limit $8`,
    [
      ...scopeParams, options.kind, options.since ?? null, options.until ?? null,
      cursor?.at ?? null, cursor?.id ?? null, options.limit + 1, PROFILE_CONTENT_MAX_DAYS,
    ],
  )
  const profiles = await client.query(
    `with scope as (${scope})
     select s.id as "personId", s.name, s.handle, s.substack_profile_id as "profileId",
       st.notes_fetched_at as "notesFetchedAt", st.notes_error as "notesError",
       st.posts_fetched_at as "postsFetchedAt", st.posts_error as "postsError"
     from scope s
     left join profile_content_state st
       on st.user_id = s.user_id and st.substack_profile_id = s.substack_profile_id
     order by lower(s.name), s.id
     limit ${PROFILE_LIMIT}`,
    scopeParams,
  )
  const page = items.rows.slice(0, options.limit)
  const last = page[page.length - 1]
  return {
    items: page,
    nextCursor: items.rows.length > options.limit && last
      ? Buffer.from(JSON.stringify({ at: new Date(last.publishedAt).toISOString(), id: last.id })).toString("base64url")
      : null,
    profiles: profiles.rows,
  }
}
