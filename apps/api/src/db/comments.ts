import type { PoolLike } from "./repositories.js"
import { decodeCursor, encodeCursor } from "./repositories.js"
import { noteUrl } from "./scheduled-notes.js"

// Feed notifications and reply trees can retain separate rows for one comment.
const commentKey = (alias: string) => `coalesce(
  nullif(${alias}.metadata->>'commentId', ''), nullif(${alias}.metadata->>'comment_id', ''),
  case when ${alias}.external_id like 'comment-%' then substr(${alias}.external_id, 9) end,
  ${alias}.external_id)`

export async function listComments(client: PoolLike, options: {
  cursor?: string
  limit?: number
  search?: string
  status?: "all" | "pending" | "not-interested"
  kind?: "all" | "note" | "post"
  excludeResponded?: boolean
  since?: string
  until?: string
} = {}) {
  const limit = options.limit ?? 50
  const now = Date.now()
  const params: unknown[] = [options.search ?? "", options.kind ?? "all", options.status ?? "all", options.excludeResponded ?? false,
    options.since ?? new Date(now - 48 * 60 * 60 * 1000).toISOString(), options.until ?? new Date(now).toISOString()]
  let cursorWhere = ""
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor)
    if (!cursor) throw new Error("Invalid cursor")
    params.push(cursor.o, cursor.d)
    cursorWhere = "and (c.occurred_at, c.id) < ($7, $8)"
  }
  params.push(limit + 1)
  const result = await client.query(
    `with candidates as (
      select i.*, ${commentKey("i")} as comment_key,
        p.name as author_name, p.handle as author_handle, p.avatar_url as author_avatar,
        o.kind as content_kind, o.title as content_title, o.body as content_body, o.url as content_url,
        o.external_id as content_root_id, conn.profile_handle as owner_handle,
        bool_or(i.not_interested) over (partition by i.connection_id, ${commentKey("i")}) as dismissed,
        row_number() over (partition by i.connection_id, ${commentKey("i")}
          order by (nullif(i.body, '') is not null) desc,
            (i.external_id like 'comment-%') desc, i.created_at desc, i.id desc) as rank
      from interactions i
      join people p on p.id = i.person_id and p.user_id = i.user_id
      join substack_connections conn on conn.id = i.connection_id and conn.user_id = i.user_id
      join owned_content o on o.user_id = i.user_id and o.connection_id = i.connection_id
        and o.external_id = coalesce(nullif(i.metadata->>'target_post_id', ''),
          nullif(i.metadata->>'rootCommentId', ''), nullif(i.metadata->>'root_comment_id', ''),
          i.thread_root_id, i.target_id)
        and o.kind = case
          when nullif(i.metadata->>'target_post_id', '') is not null then 'post'
          when nullif(i.metadata->>'rootCommentId', '') is not null
            or nullif(i.metadata->>'root_comment_id', '') is not null then 'note'
          else coalesce(i.thread_kind, i.target_type) end
      where i.direction = 'inbound' and i.action_type in ('comment', 'reply') and i.removed_at is null
    ), comments as (
      select c.*,
        exists (select 1 from interactions a
          where a.user_id = c.user_id and a.connection_id = c.connection_id
            and a.direction = 'outbound' and a.removed_at is null
            and a.action_type in ('comment', 'reply') and a.target_id = c.comment_key
            and (a.action_type = 'reply' or a.target_type = 'comment')) as replied,
        exists (select 1 from interactions a
          where a.user_id = c.user_id and a.connection_id = c.connection_id
            and a.direction = 'outbound' and a.removed_at is null
            and a.action_type = 'like' and a.target_type = 'comment' and a.target_id = c.comment_key) as liked
      from candidates c where c.rank = 1
    )
    select c.id, c.person_id as "personId", c.comment_key as "commentId", c.body,
      c.occurred_at as "occurredAt", c.author_name as "authorName",
      c.author_handle as "authorHandle", c.author_avatar as "authorAvatar",
      c.content_kind as "contentKind", c.content_title as "contentTitle",
      c.content_body as "contentBody", c.content_url as "contentUrl",
      c.content_root_id as "contentRootId", c.owner_handle as "ownerHandle", c.target_url as "fallbackUrl",
      c.replied, c.liked, c.dismissed as "notInterested"
    from comments c
    where ($1 = '' or concat_ws(' ', c.author_name, c.author_handle, c.body, c.content_title, c.content_body) ilike '%' || $1 || '%')
      and ($2 = 'all' or c.content_kind = $2)
      and ($3 = 'all' or ($3 = 'pending' and not c.dismissed and not c.replied and not c.liked)
        or ($3 = 'not-interested' and c.dismissed))
      and (not $4::boolean or (not c.replied and not c.liked))
      and c.occurred_at >= $5::timestamptz and c.occurred_at < $6::timestamptz
      ${cursorWhere}
    order by c.occurred_at desc, c.id desc limit $${params.length}`,
    params,
  )
  const comments = result.rows.slice(0, limit).map(({ contentRootId, ownerHandle, fallbackUrl, ...comment }) => ({
    ...comment,
    contentUrl: comment.contentUrl || (comment.contentKind === "note" ? noteUrl(ownerHandle, contentRootId.replace(/^c-/, "")) : null) || fallbackUrl,
  }))
  const last = comments.at(-1)
  return {
    comments,
    nextCursor: result.rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null,
  }
}

export async function setCommentNotInterested(client: PoolLike, id: string, notInterested: boolean) {
  const result = await client.query(
    `update interactions i set not_interested = $2
     from interactions selected
     where selected.id = $1 and selected.direction = 'inbound'
       and selected.action_type in ('comment', 'reply') and selected.removed_at is null
       and i.user_id = selected.user_id and i.connection_id is not distinct from selected.connection_id
       and i.direction = 'inbound' and i.action_type in ('comment', 'reply')
       and ${commentKey("i")} = ${commentKey("selected")}
     returning i.id`,
    [id, notInterested],
  )
  return result.rows.length > 0
}
