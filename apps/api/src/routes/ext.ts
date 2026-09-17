import { createHash, randomUUID } from "node:crypto"
import { Hono } from "hono"
import {
  createSubstackClient,
  ingestActivityBatch,
  ingestConversationReplies,
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
import { withTenant } from "../db/tenant.js"

export const ext = new Hono<{ Variables: { appUser: string; userEmail: string } }>()

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
        lists: lists.map((l) => ({ id: l.id, name: l.name, description: null })),
        handles,
        members,
      },
    })
  })
})

// POST /api/ext/activity - Receive passively captured activity batches
ext.post("/activity", async (c) => {
  const userId = c.get("appUser")
  let payload: any
  try {
    payload = await c.req.json()
  } catch {
    return c.json({ ok: false, message: "Invalid JSON payload" }, 400)
  }

  return withTenant({ appUserId: userId }, async (client) => {
    const connRes = await client.query(
      `select id, profile_id, profile_handle
       from substack_connections
       where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId]
    )
    const conn = connRes.rows[0]
    const connectionId = conn?.id ?? null
    const ownerHandle = conn?.profile_handle ?? null
    const ownerId = conn?.profile_id ?? null

    // Reject cross-account queued data if expectedConnectionId does not match
    if (
      payload?.expectedConnectionId &&
      connectionId &&
      payload.expectedConnectionId !== connectionId
    ) {
      return c.json(
        {
          ok: false,
          rejected: true,
          message: "Connection mismatch. Queued data belongs to a different or revoked connection.",
        },
        409
      )
    }

    // Compute deterministic dedupe key for idempotent replay safety
    const rawBatch = typeof payload === "object" ? JSON.stringify(payload) : String(payload)
    const dedupeKey = createHash("sha256")
      .update(`${userId}:${connectionId ?? "none"}:${rawBatch}`)
      .digest("hex")

    // Check if this batch has already been processed
    const existingBatch = await client.query(
      "select id, status from ingestion_batches where user_id = $1 and dedupe_key = $2",
      [userId, dedupeKey]
    )
    if (existingBatch.rows[0]?.status === "processed") {
      return c.json({ ok: true, deduplicated: true, captured: 0, message: "Batch already ingested" })
    }

    const batchId = existingBatch.rows[0]?.id ?? randomUUID()
    if (!existingBatch.rows[0]) {
      await client.query(
        `insert into ingestion_batches (id, user_id, source, dedupe_key, payload, status, received_at)
         values ($1, $2, 'extension', $3, $4, 'received', now())
         on conflict (user_id, dedupe_key) do nothing`,
        [batchId, userId, dedupeKey, JSON.stringify(payload)]
      )
    }

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
        const items: ActivityItemInput[] = Array.isArray(payload?.activityItems)
          ? payload.activityItems
          : Array.isArray(payload)
          ? payload
          : []

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

      return c.json({ ok: true, captured: stats.processedItems, ...stats })
    } catch (error: any) {
      await client.query(
        "update ingestion_batches set status = 'failed', error = $3 where id = $1 and user_id = $2",
        [batchId, userId, String(error?.message || error)]
      )
      throw error
    }
  })
})

// POST /app/community - Extension quick-add contact, lists, and tags
ext.post("/community", async (c) => {
  const userId = c.get("appUser")
  const form = await c.req.formData()
  const intent = form.get("intent")
  if (intent !== "createPerson") {
    return c.json({ ok: false, message: "Unsupported intent" }, 400)
  }

  const name = String(form.get("name") || "").trim()
  const handle = String(form.get("handle") || "").trim().replace(/^@/, "")
  const lists = form.getAll("lists").map(String)
  const tags = form
    .getAll("tags")
    .flatMap((t) =>
      String(t)
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= 32)
    )

  if (!name || !handle) {
    return c.json({ ok: false, message: "Name and handle are required" }, 400)
  }

  return withTenant({ appUserId: userId }, async (client) => {
    const existing = await client.query(
      "select id from people where user_id = $1 and normalized_handle = $2 and archived_at is null limit 1",
      [userId, normalizeHandle(handle)]
    )

    let personId = existing.rows[0]?.id as string | undefined
    if (!personId) {
      const created = await createPerson(client, userId, {
        name,
        handle,
        relationshipStatus: "new",
        profileUrl: `https://substack.com/@${encodeURIComponent(normalizeHandle(handle))}`,
      })
      personId = created.id
    }

    for (const listId of lists) {
      if (listId) {
        await addListMember(client, userId, listId, personId)
      }
    }

    for (const tagName of tags) {
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
})

// POST /app/settings - Connect Substack session (plaintext, bare-bones)
ext.post("/settings", async (c) => {
  const userId = c.get("appUser")
  const form = await c.req.formData()
  const intent = form.get("intent")
  if (intent !== "connect") {
    return c.json({ ok: false, message: "Unsupported intent" }, 400)
  }

  const envelopeRaw = form.get("envelope")
  const publicationUrl = String(form.get("publicationUrl") || "").trim() || null

  let sessionToken = ""
  if (typeof envelopeRaw === "string") {
    try {
      const parsed = JSON.parse(envelopeRaw)
      sessionToken = parsed.ciphertext || parsed.sessionToken || ""
    } catch {
      sessionToken = envelopeRaw
    }
  }

  if (!sessionToken.trim()) {
    return c.json({ ok: false, message: "Substack session token is required" }, 400)
  }

  // Verify connection with Substack SDK
  let profileName: string | null = null
  let profileHandle: string | null = null
  let profileId: string | null = null

  try {
    const client = createSubstackClient({ sessionToken, publicationUrl })
    const self = (await client.getAuthenticatedProfile()) as {
      id?: string | number
      name?: string
      handle?: string
    }
    profileName = self?.name ?? null
    profileHandle = self?.handle ?? null
    profileId = self?.id ? String(self.id) : null
  } catch (error) {
    console.warn("Could not verify Substack credentials with SDK:", error)
  }

  return withTenant({ appUserId: userId }, async (client) => {
    // Get next generation
    const genRes = await client.query(
      "select coalesce(max(generation), 0) + 1 as next_gen from substack_connections where user_id = $1",
      [userId]
    )
    const nextGen = genRes.rows[0]?.next_gen ?? 1

    // Mark previous active connections as revoked
    await client.query(
      "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status = 'active'",
      [userId]
    )

    const connId = randomUUID()
    await client.query(
      `insert into substack_connections
          (id, user_id, generation, status, publication_url, envelope_version,
           key_id, wrapped_key, iv, ciphertext,
           profile_id, profile_name, profile_handle, last_verified_at)
       values ($1, $2, $3, 'active', $4, 1, 'plain', 'plain', 'plain', $5, $6, $7, $8, now())`,
      [
        connId,
        userId,
        nextGen,
        publicationUrl,
        sessionToken,
        profileId,
        profileName,
        profileHandle,
      ]
    )

    // Also initialize sync_state
    await client.query(
      `insert into sync_state (connection_id, user_id, status, next_run_at)
       values ($1, $2, 'idle', now())
       on conflict (connection_id) do nothing`,
      [connId, userId]
    )

    return c.json({
      ok: true,
      submit: { ok: true, message: "Connected Substack successfully." },
    })
  })
})

// POST /app/companion - Track extension install
ext.post("/companion", async (c) => {
  const userId = c.get("appUser")
  return withTenant({ appUserId: userId }, async (client) => {
    await client.query(
      "update app_users set extension_installed_at = now(), updated_at = now() where id = $1",
      [userId]
    )
    return c.json({ ok: true, submit: { ok: true } })
  })
})
