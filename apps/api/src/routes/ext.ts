import { createHash, randomUUID } from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import {
  applyFollowingSnapshot,
  createSubstackClient,
  ingestActivityBatch,
  ingestConversationReplies,
  normalizeActivityPage,
  openSessionToken,
  parseFollowingIds,
  parseSubscriberStatsPage,
  reconcileSubscriberSnapshot,
  upsertSubscribersBatch,
  type ActivityItemInput,
} from "@workspace/core"

import { auth } from "../auth.js"
import {
  addListMember,
  attachTag,
  createPerson,
  createTag,
  getOrCreateAppUser,
  listLists,
  normalizeHandle,
} from "../db/repositories.js"
import {
  replaceSubstackConnection,
  SubstackVerificationError,
  verifySubstackSession,
} from "../db/connections.js"
import { withTenant } from "../db/tenant.js"

export const ext = new Hono<{ Variables: { appUser: string; userEmail: string } }>()

function substackAuthor(
  value: unknown,
): { id?: string; handle: string; name?: string | null; photo_url?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, any>
  const nested = [
    data,
    data.user,
    data.author,
    data.comment?.user,
    data.comment?.author,
    data.item?.comment?.user,
    data.post?.user,
    data.post?.author,
    data.publishedBylines?.[0],
    data.post?.publishedBylines?.[0],
  ]
  for (const candidate of nested) {
    if (!candidate || typeof candidate !== "object") continue
    const handle = candidate.handle ?? candidate.username
    if (typeof handle === "string" && handle.trim()) {
      return {
        id: candidate.id === undefined ? undefined : String(candidate.id),
        handle: handle.trim().replace(/^@/, ""),
        name: typeof candidate.name === "string" ? candidate.name : null,
        ...(typeof candidate.photo_url === "string" && { photo_url: candidate.photo_url }),
      }
    }
  }
  return null
}

/**
 * True for a URL that points at one post, Note, or comment. The extension
 * falls back to the page the action happened on, which is often the feed.
 */
export function isSubstackContentUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const { protocol, pathname } = new URL(value)
    return protocol === "https:" &&
      /\/p\/[^/]+|\/(?:home|inbox)\/post\/p-?\d+|\/note\/c-\d+|\/comment\/\d+/.test(pathname)
  } catch {
    return false
  }
}

function substackText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== "object") return
    const item = node as Record<string, unknown>
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text)
    visit(item.content)
  }
  visit(value)
  return parts.join(" ").trim() || null
}

function substackTargetContext(value: unknown, targetKind: string, targetId: string) {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
  const target = targetKind === "post"
    ? data.post ?? data.item?.post ?? data
    : data.comment ?? data.item?.comment ?? data
  const author = substackAuthor(target)
  const targetBody = targetKind === "post"
    ? substackText(target?.subtitle ?? target?.truncated_body_text)
    : substackText(target?.body ?? target?.body_text ?? target?.body_json)
  const noteId = targetId.startsWith("c-") ? targetId : `c-${targetId}`
  const targetUrl = target?.canonical_url ?? target?.url ?? (
    author?.handle && targetKind !== "post"
      ? `https://substack.com/@${encodeURIComponent(author.handle)}/note/${encodeURIComponent(noteId)}`
      : null
  )
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)
  return {
    author,
    targetBody,
    targetTitle: typeof target?.title === "string" ? target.title : null,
    targetUrl: typeof targetUrl === "string" ? targetUrl : null,
    targetImage: targetKind === "post" ? text(target?.cover_image) : null,
    targetPublication: targetKind === "post"
      ? text(data.publication?.name) ?? text(target?.publication?.name)
      : null,
  }
}

// Authenticate via session cookie forwarded from browser
ext.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json(
      { ok: false, needsAuth: true, message: "Log in to Circles first." },
      401
    )
  }
  c.set("appUser", await getOrCreateAppUser(session.user.id))
  c.set("userEmail", session.user.email)
  await next()
})

// GET /api/ext/companion - Extension bridge checks app state
ext.get("/companion", async (c) => {
  const userId = c.get("appUser")
  return withTenant({ appUserId: userId }, async (client) => {
    // Active Substack connection
    const connRes = await client.query(
      `select id, publication_url, profile_id, profile_name, profile_handle,
              created_at as "createdAt", updated_at as "updatedAt",
              last_verified_at as "lastVerifiedAt"
       from substack_connections
       where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId]
    )
    const conn = connRes.rows[0]
    // The extension's notifications poll reads back to the same checkpoint the worker uses.
    const checkpoint = conn
      ? await client.query(
          "select last_synced_at from sync_stream_state where connection_id = $1 and stream = 'activity'",
          [conn.id],
        )
      : null
    const connection = conn
      ? {
          id: conn.id,
          publicationUrl: conn.publication_url,
          profile: {
            id: conn.profile_id,
            name: conn.profile_name,
            handle: conn.profile_handle,
          },
          lastVerifiedAt: conn.lastVerifiedAt ?? conn.updatedAt,
          createdAt: conn.createdAt,
          updatedAt: conn.updatedAt,
        }
      : null

    // Lists
    const lists = await listLists(client)

    // Known people and their list memberships
    const peopleRes = await client.query(
      `select p.id, p.name, p.handle, p.normalized_handle,
              coalesce(json_agg(json_build_object('id', l.id, 'name', l.name)) filter (where l.id is not null), '[]') as lists
       from people p
       left join list_members lm on lm.person_id = p.id and lm.user_id = p.user_id
       left join lists l on l.id = lm.list_id and l.user_id = p.user_id
       where p.user_id = $1 and p.archived_at is null and p.handle is not null
       group by p.id, p.name, p.handle, p.normalized_handle`,
      [userId]
    )

    const handles = peopleRes.rows.map((r: any) => r.normalized_handle)
    const members = peopleRes.rows.map((r: any) => ({
      name: r.name,
      handle: r.normalized_handle,
      lists: r.lists,
    }))

    return c.json({
      ok: true,
      appState: {
        user: {
          id: userId,
          email: c.get("userEmail"),
        },
        connection,
        activitySyncedAt: checkpoint?.rows[0]?.last_synced_at ?? null,
        lists: lists.map((l) => ({ id: l.id, name: l.name, description: null })),
        handles,
        members,
      },
    })
  })
})

/** Largest capture body accepted from the extension queue. */
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024

const captureBodyLimit = bodyLimit({
  maxSize: MAX_CAPTURE_BYTES,
  onError: (c) => c.json({ ok: false, message: "Capture payload is too large" }, 413),
})

// POST /api/ext/activity - Receive passively captured activity batches
ext.post("/activity", captureBodyLimit, async (c) => {
  const userId = c.get("appUser")
  let payload: any
  try {
    payload = await c.req.json()
  } catch {
    return c.json({ ok: false, message: "Invalid JSON payload" }, 400)
  }

  // Read connection state and dedupe in a short transaction.
  const state = await withTenant({ appUserId: userId }, async (client) => {
    const connRes = await client.query(
      `select id, profile_id, profile_handle, key_id, iv, ciphertext, publication_url
       from substack_connections
       where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId]
    )
    const conn = connRes.rows[0]
    const connectionId: string | null = conn?.id ?? null

    // Reject cross-account queued data if expectedConnectionId does not match
    if (
      payload?.expectedConnectionId &&
      connectionId &&
      payload.expectedConnectionId !== connectionId
    ) {
      return { kind: "mismatch" as const }
    }

    // Deduplicate the captured payload before any optional Substack lookup.
    // A queued retry should never repeat the authenticated target request.
    const rawBatch = typeof payload === "object" ? JSON.stringify(payload) : String(payload)
    const dedupeKey = createHash("sha256")
      .update(`${userId}:${connectionId ?? "none"}:${rawBatch}`)
      .digest("hex")
    const existingBatch = await client.query(
      "select id, status from ingestion_batches where user_id = $1 and dedupe_key = $2",
      [userId, dedupeKey]
    )
    if (existingBatch.rows[0]?.status === "processed") return { kind: "duplicate" as const }
    return {
      kind: "ingest" as const,
      conn,
      connectionId,
      dedupeKey,
      existingBatchId: (existingBatch.rows[0]?.id as string | undefined) ?? null,
    }
  })

  if (state.kind === "mismatch") {
    return c.json(
      {
        ok: false,
        rejected: true,
        message: "Connection mismatch. Queued data belongs to a different or revoked connection.",
      },
      409
    )
  }
  if (state.kind === "duplicate") {
    return c.json({ ok: true, deduplicated: true, captured: 0, message: "Batch already ingested" })
  }

  const { conn, connectionId, dedupeKey } = state
  const ownerHandle = conn?.profile_handle ?? null
  const ownerId = conn?.profile_id ?? null

  // Mutation responses often omit the target identity. Resolve it from the
  // authenticated reader API so outbound actions attach to the actual person,
  // including replies made from the owner's own post/Note page. This runs
  // outside any transaction so a slow upstream never holds a pooled connection.
  // The lookup also supplies the real post/Note URL in place of the page URL.
  if (payload?.kind === "outbound-action" && !isSubstackContentUrl(payload.targetUrl)) {
    payload.targetUrl = null
  }
  if (
    payload?.kind === "outbound-action" &&
    (payload.targetKind === "comment" || !payload?.targetAuthor?.handle || !payload?.targetBody ||
      !payload.targetUrl) &&
    conn?.ciphertext
  ) {
    try {
      const sdk = createSubstackClient({
        sessionToken: openSessionToken(conn),
        publicationUrl: conn.publication_url,
      })
      const target = payload.targetKind === "post"
        ? await sdk.getPost(payload.targetId)
        : await sdk.getComment(payload.targetId)
      const context = substackTargetContext(target, payload.targetKind, String(payload.targetId))
      if (context.author) payload.targetAuthor = context.author
      if (context.targetBody) payload.targetBody = context.targetBody
      if (context.targetTitle) payload.targetTitle = context.targetTitle
      if (context.targetUrl) payload.targetUrl = context.targetUrl
      if (context.targetImage) payload.targetImage = context.targetImage
      if (context.targetPublication) payload.targetPublication = context.targetPublication
    } catch (error) {
      console.warn("Could not resolve outbound Substack target author:", (error as Error)?.message ?? error)
    }
  }

  return withTenant({ appUserId: userId }, async (client) => {
    const batchId = state.existingBatchId ?? randomUUID()
    if (!state.existingBatchId) {
      await client.query(
        `insert into ingestion_batches (id, user_id, source, dedupe_key, payload, status, received_at)
         values ($1, $2, 'extension', $3, $4, 'received', now())
         on conflict (user_id, dedupe_key) do nothing`,
        [batchId, userId, dedupeKey, JSON.stringify(payload)]
      )
    }

    await client.query("savepoint extension_capture_ingestion")
    try {
      let stats: any
      if (payload?.kind === "conversation") {
        stats = await ingestConversationReplies(client, {
          userId,
          connectionId,
          ownerHandle,
          ownerId,
          conversation: payload,
          source: "extension",
        })
      } else {
        const items: ActivityItemInput[] = payload?.kind === "outbound-action"
          ? [payload]
          : normalizeActivityPage(payload)

        stats = await ingestActivityBatch(client, {
          userId,
          connectionId,
          ownerHandle,
          ownerId,
          items,
          source: "extension",
        })
      }

      await client.query(
        "update ingestion_batches set status = 'processed', processed_at = now() where id = $1 and user_id = $2",
        [batchId, userId]
      )
      await client.query("release savepoint extension_capture_ingestion")

      return c.json({ ok: true, captured: stats.processedItems, ...stats })
    } catch (error: any) {
      await client.query("rollback to savepoint extension_capture_ingestion")
      const errorMessage = String(error?.message || error)
      await client.query(
        "update ingestion_batches set status = 'failed', error = $3 where id = $1 and user_id = $2",
        [batchId, userId, errorMessage]
      )
      await client.query("release savepoint extension_capture_ingestion")
      console.error("[Circles API] Extension capture ingestion failed:", errorMessage)
      return c.json({ ok: false, message: "Capture ingestion failed" }, 500)
    }
  })
})

/** Mirrors the worker's full subscriber sweep (apps/worker/src/audience.ts). */
const SUBSCRIBER_PAGE_OVERLAP = 10
const MAX_BROWSER_RUN_MS = 6 * 60 * 60 * 1000

/**
 * Reads the extension made with the user's own Substack session. Activity
 * pages arrive through /activity like any capture; this records that a poll
 * finished and applies the audience lists. Each one tells the worker to skip
 * its own read (apps/worker/src/jobs.ts).
 */
ext.post("/browser-reads", captureBodyLimit, async (c) => {
  const userId = c.get("appUser")
  const body = await c.req.json().catch(() => null) as
    | { kind?: string; connectionId?: string; payload?: unknown; offset?: unknown; runStartedAt?: unknown }
    | null
  if (!body || typeof body.connectionId !== "string") return c.json({ ok: false, message: "Invalid request" }, 400)
  const connectionId = body.connectionId

  return withTenant({ appUserId: userId }, async (client) => {
    const conn = (await client.query(
      `select id, browser_subscriber_run from substack_connections
       where id = $1 and user_id = $2 and status = 'active' for update`,
      [connectionId, userId],
    )).rows[0]
    if (!conn) return c.json({ ok: false, rejected: true, message: "This Substack connection is no longer active." }, 409)

    if (body.kind === "activity") {
      // The extension read newest-first back to this connection's checkpoint.
      await client.query(
        `insert into sync_stream_state
            (connection_id, user_id, stream, status, last_synced_at, completeness, error, updated_at)
         values ($1, $2, 'activity', 'idle', now(), 'partial', null, now())
         on conflict (connection_id, stream) do update
           set status = 'idle', last_synced_at = now(), error = null, updated_at = now()`,
        [connectionId, userId],
      )
      await client.query(
        "update sync_state set last_synced_at = now(), status = 'idle', error = null, updated_at = now() where connection_id = $1",
        [connectionId],
      )
      await client.query("update substack_connections set browser_activity_at = now() where id = $1", [connectionId])
      return c.json({ ok: true })
    }

    if (body.kind === "following") {
      let page: ReturnType<typeof parseFollowingIds>
      try { page = parseFollowingIds(body.payload) } catch { return c.json({ ok: false, message: "Invalid following list" }, 400) }
      const result = await applyFollowingSnapshot(client, userId, page.followers, false)
      await client.query("update substack_connections set browser_following_at = now() where id = $1", [connectionId])
      // Like the worker's sweep: name the ID-only contacts it created.
      if (result.created > 0) {
        await client.query(
          `insert into jobs (type, payload, status, run_at)
           select 'enrich:missing-handles', $1::jsonb, 'pending', now() + interval '1 minute'
           where not exists (select 1 from jobs where type = 'enrich:missing-handles'
             and status in ('pending', 'running') and payload->>'connectionId' = $2)`,
          [JSON.stringify({ userId, connectionId, placeholdersOnly: true }), connectionId],
        )
      }
      return c.json({ ok: true, checked: result.checked, created: result.created })
    }

    if (body.kind === "subscribers") {
      const offset = Number(body.offset)
      if (!Number.isInteger(offset) || offset < 0) return c.json({ ok: false, message: "Invalid subscriber sweep" }, 400)
      // The server stamps a run's start, so a skewed browser clock cannot make
      // reconcile treat people seen in this run as missing.
      const current = conn.browser_subscriber_run as { runStartedAt?: string; nextOffset?: number } | null
      let run = new Date().toISOString()
      if (offset !== 0) {
        // Pages must arrive in order from one recent sweep; anything else restarts it.
        if (!current?.runStartedAt || body.runStartedAt !== current.runStartedAt || current.nextOffset !== offset ||
          Date.now() - Date.parse(current.runStartedAt) > MAX_BROWSER_RUN_MS) {
          return c.json({ ok: false, restart: true, message: "Subscriber sweep out of order; start again." }, 409)
        }
        run = current.runStartedAt
      }
      let page: ReturnType<typeof parseSubscriberStatsPage>
      try { page = parseSubscriberStatsPage(body.payload) } catch { return c.json({ ok: false, message: "Invalid subscriber page" }, 400) }
      const batch = await upsertSubscribersBatch(client, userId, page.subscribers, new Date().toISOString())
      const completed = page.received === 0 || offset + page.received >= page.total
      // Overlap pages so a subscriber who leaves mid-sweep cannot shift someone past a page boundary.
      const nextOffset = completed ? offset + page.received : offset + Math.max(1, page.received - SUBSCRIBER_PAGE_OVERLAP)
      const deactivated = completed ? await reconcileSubscriberSnapshot(client, userId, run) : 0
      await client.query(
        `update substack_connections
         set browser_subscriber_run = $2::jsonb,
             browser_subscribers_at = case when $3 then now() else browser_subscribers_at end
         where id = $1`,
        [connectionId, completed ? null : JSON.stringify({ runStartedAt: run, nextOffset }), completed],
      )
      return c.json({ ok: true, completed, nextOffset, runStartedAt: run, matched: batch.matched, created: batch.created, deactivated })
    }

    return c.json({ ok: false, message: "Unknown read" }, 400)
  })
})

// Handler for adding contact to CRM with lists & tags (accepts JSON or FormData)
async function handleCreatePerson(c: any) {
  const userId = c.get("appUser")
  let name = ""
  let handle = ""
  let lists: string[] = []
  let tags: string[] = []

  const contentType = c.req.header("content-type") || ""
  if (contentType.includes("application/json")) {
    const body = await c.req.json().catch(() => ({}))
    name = String(body.name || "").trim()
    handle = String(body.handle || "").trim().replace(/^@/, "")
    lists = Array.isArray(body.lists) ? body.lists.map(String) : []
    tags = Array.isArray(body.tags)
      ? body.tags.map(String)
      : typeof body.tags === "string"
      ? body.tags.split(",").map((s: string) => s.trim())
      : []
  } else {
    const form = await c.req.formData()
    name = String(form.get("name") || "").trim()
    handle = String(form.get("handle") || "").trim().replace(/^@/, "")
    lists = form.getAll("lists").map(String)
    tags = form
      .getAll("tags")
      .flatMap((t: any) =>
        String(t)
          .split(",")
          .map((tag: string) => tag.trim())
          .filter((tag: string) => tag.length > 0 && tag.length <= 32)
      )
  }

  if (!name || !handle) {
    return c.json({ ok: false, message: "Name and handle are required" }, 400)
  }

  const normalizedHandle = normalizeHandle(handle)
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(normalizedHandle)) {
    return c.json({ ok: false, message: "Invalid Substack handle" }, 400)
  }

  return withTenant({ appUserId: userId }, async (client) => {
    const existing = await client.query(
      "select id from people where user_id = $1 and normalized_handle = $2 and archived_at is null limit 1",
      [userId, normalizedHandle]
    )

    let personId = existing.rows[0]?.id as string | undefined
    if (!personId) {
      const created = await createPerson(client, userId, {
        name,
        handle,
        relationshipStatus: "new",
        profileUrl: `https://substack.com/@${encodeURIComponent(normalizedHandle)}`,
      })
      personId = created.id
    }

    for (const listId of lists) {
      if (listId) {
        await addListMember(client, userId, listId, personId)
      }
    }

    for (const tagName of tags) {
      if (!tagName) continue
      const existingTag = await client.query(
        "select id from tags where user_id = $1 and normalized_name = lower($2) limit 1",
        [userId, tagName]
      )
      let tagId = existingTag.rows[0]?.id
      if (!tagId) {
        const createdTag = await createTag(client, userId, tagName)
        tagId = createdTag.id
      }
      await attachTag(client, userId, tagId, personId)
    }

    return c.json({
      ok: true,
      submit: { ok: true, message: "Saved to CRM." },
    })
  })
}

ext.post("/person", handleCreatePerson)
ext.post("/community", handleCreatePerson)

// Handler for connecting Substack session (accepts JSON or FormData)
async function handleConnect(c: any) {
  const userId = c.get("appUser")
  let sessionToken = ""
  let publicationUrl: string | null = null

  const contentType = c.req.header("content-type") || ""
  if (contentType.includes("application/json")) {
    const body = await c.req.json().catch(() => ({}))
    sessionToken = String(body.sessionToken || body.ciphertext || "").trim()
    publicationUrl = body.publicationUrl ? String(body.publicationUrl).trim() : null
  } else {
    const form = await c.req.formData()
    const envelopeRaw = form.get("envelope")
    publicationUrl = String(form.get("publicationUrl") || "").trim() || null

    if (typeof envelopeRaw === "string") {
      try {
        const parsed = JSON.parse(envelopeRaw)
        sessionToken = parsed.ciphertext || parsed.sessionToken || ""
      } catch {
        sessionToken = envelopeRaw
      }
    } else {
      sessionToken = String(form.get("sessionToken") || "")
    }
  }

  if (!sessionToken.trim()) {
    return c.json({ ok: false, message: "Substack session token is required" }, 400)
  }

  let profile
  try {
    profile = await verifySubstackSession(sessionToken, publicationUrl)
  } catch (error) {
    // Keep the existing working connection when the new session is not usable.
    if (error instanceof SubstackVerificationError) {
      // Released extensions read the top-level message on non-2xx responses.
      return c.json({ ok: false, message: error.message, submit: { ok: false, message: error.message } }, 400)
    }
    throw error
  }

  await withTenant({ appUserId: userId }, (client) =>
    replaceSubstackConnection(client, userId, { sessionToken, publicationUrl, profile })
  )

  return c.json({
    ok: true,
    submit: { ok: true, message: "Connected Substack successfully." },
    profile,
  })
}

ext.post("/connect", handleConnect)
ext.post("/settings", handleConnect)

// Handler for extension installation ping
async function handleInstall(c: any) {
  const userId = c.get("appUser")
  return withTenant({ appUserId: userId }, async (client) => {
    await client.query(
      "update app_users set extension_installed_at = now(), updated_at = now() where id = $1",
      [userId]
    )
    return c.json({ ok: true, submit: { ok: true, message: "Extension registered." } })
  })
}

ext.post("/install", handleInstall)
ext.post("/companion", handleInstall)
