import type { PoolClient } from "pg"
import {
  createSubstackClient,
  ingestActivityBatch,
  normalizeActivityPage,
} from "@workspace/core"
import {
  normalizeOutboundProfileFeed,
  replayOwnedNoteSnapshots,
} from "./history.js"
import { withTenant } from "./tenant.js"

export async function processProfileEnrichment(
  client: PoolClient,
  userId: string,
  personId: string
) {
  return withTenant(client, userId, async () => {
    // 1. Fetch person details
    const personRes = await client.query(
      `select id, handle, normalized_handle, substack_profile_id, name
       from people
       where id = $1 and user_id = $2 and archived_at is null`,
      [personId, userId]
    )
    const person = personRes.rows[0]
    if (!person || !person.normalized_handle) return { skipped: true }

    // 2. Fetch active connection
    const connRes = await client.query(
      `select id, ciphertext, publication_url
       from substack_connections
       where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId]
    )
    const conn = connRes.rows[0]
    if (!conn) return { skipped: true }

    // 3. Try to fetch profile via Substack SDK or public reader API
    try {
      const sdk = createSubstackClient({
        sessionToken: conn.ciphertext,
        publicationUrl: conn.publication_url,
      })
      let profileData: any = null
      try {
        if (typeof (sdk as any).getProfile === "function") {
          profileData = await (sdk as any).getProfile(person.normalized_handle)
        }
      } catch {
        // SDK might not support getProfile directly
      }

      // 4. Update profile_snapshots
      await client.query(
        `insert into profile_snapshots
            (person_id, user_id, connection_id, schema_version, payload, fetched_at, last_attempted_at)
         values ($1, $2, $3, 1, $4, now(), now())
         on conflict (person_id) do update
          set connection_id = excluded.connection_id,
              payload = coalesce(excluded.payload, profile_snapshots.payload),
              fetched_at = case when excluded.payload is not null then now() else profile_snapshots.fetched_at end,
              last_attempted_at = now(),
              last_error = null`,
        [personId, userId, conn.id, profileData ? JSON.stringify(profileData) : null]
      )

      // 5. Monotonic enrichment on people table
      if (profileData?.name && (!person.name || person.name === person.handle)) {
        await client.query(
          "update people set name = $1, updated_at = now() where id = $2 and user_id = $3",
          [profileData.name, personId, userId]
        )
      }
      const enrichedPhoto =
        profileData?.photo_url ||
        profileData?.photoUrl ||
        profileData?.avatar_url ||
        profileData?.avatarUrl ||
        null
      if (enrichedPhoto) {
        await client.query(
          "update people set avatar_url = $1, updated_at = now() where id = $2 and user_id = $3 and (avatar_url is null or avatar_url = '')",
          [enrichedPhoto, personId, userId]
        )
      }

      return { success: true }
    } catch (err: any) {
      await client.query(
        `insert into profile_snapshots
            (person_id, user_id, connection_id, schema_version, last_attempted_at, last_error)
         values ($1, $2, $3, 1, now(), $4)
         on conflict (person_id) do update
          set last_attempted_at = now(),
              last_error = excluded.last_error`,
        [personId, userId, conn.id, err?.message || "Unknown error"]
      )
      return { success: false, error: err?.message }
    }
  })
}

export async function processStoredNoteReplay(
  client: PoolClient,
  userId: string,
  connectionId: string,
  afterNoteId?: string | null,
) {
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select profile_id, profile_handle, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active") return { completed: true, nextCursor: null }
    const result = await replayOwnedNoteSnapshots(client, {
      userId,
      connectionId,
      ownerId: conn.profile_id,
      ownerHandle: conn.profile_handle,
      source: "import",
    }, afterNoteId)
    return { completed: result.complete, nextCursor: result.nextCursor }
  })
}

export async function processStoredInteractionEvidence(
  client: PoolClient,
  userId: string,
  connectionId: string,
  cursor?: { activityDone?: boolean; afterReceivedAt?: string | null; afterBatchId?: string | null },
) {
  return withTenant(client, userId, async () => {
    const connection = await client.query(
      `select profile_id, profile_handle, status, created_at
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )
    const conn = connection.rows[0]
    if (!conn || conn.status !== "active" || !conn.profile_id) {
      return { completed: true, cursor: null }
    }

    const context = {
      userId,
      connectionId,
      ownerId: String(conn.profile_id),
      ownerHandle: conn.profile_handle ?? null,
    }

    if (!cursor?.activityDone) {
      const snapshot = await client.query(
        `select payload from activity_snapshots
         where connection_id = $1 order by captured_at desc limit 1`,
        [connectionId],
      )
      if (snapshot.rows[0]?.payload) {
        await ingestActivityBatch(client, {
          ...context,
          items: normalizeActivityPage(snapshot.rows[0].payload),
          source: "import",
        })
      }
    }

    const page = await client.query(
      `select id, source, payload, received_at
       from ingestion_batches
       where user_id = $1
         and received_at >= $2
         and (payload ? 'profileFeedStage' or payload ? 'activityItems')
         and ($3::timestamptz is null or (received_at, id) > ($3::timestamptz, $4::text))
       order by received_at, id
       limit 10`,
      [userId, conn.created_at, cursor?.afterReceivedAt ?? null, cursor?.afterBatchId ?? ""],
    )

    for (const row of page.rows) {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
      const stage = payload?.profileFeedStage
      const items = stage === "likes" || stage === "restacks"
        ? normalizeOutboundProfileFeed(
            Array.isArray(payload?.page?.items) ? payload.page.items : [],
            context.ownerId,
          )
        : normalizeActivityPage(payload)
      await ingestActivityBatch(client, {
        ...context,
        items,
        source: row.source === "sdk" ? "sdk" : "import",
      })
    }

    const last = page.rows.at(-1)
    return {
      completed: page.rows.length < 10,
      cursor: last
        ? {
            activityDone: true,
            afterReceivedAt: new Date(last.received_at).toISOString(),
            afterBatchId: String(last.id),
          }
        : null,
    }
  })
}
