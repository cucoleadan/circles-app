import { Hono } from "hono"

import {
  parseFollowerRunStartedAt,
  parseSubscriberStatsPage,
  shouldAbortFollowerSweep,
} from "../../audience-sync.js"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const syncRoutes = new Hono<V1Env>()

syncRoutes.get("/sync", async (c) => {
  const appUser = c.get("appUser")
  const state = await withTenant({ appUserId: appUser }, async (client) => {
    const res = await client.query(
      `select s.connection_id as "connectionId", s.status, s.cursor,
              s.last_synced_at as "lastSyncedAt", s.next_run_at as "nextRunAt",
              s.error
       from sync_state s
       join substack_connections c on c.id = s.connection_id
       where s.user_id = $1 and c.status = 'active'
       order by c.generation desc limit 1`,
      [appUser]
    )
    return res.rows[0] ?? null
  })
  return c.json({ syncState: state })
})

syncRoutes.post("/sync", async (c) => {
  const appUser = c.get("appUser")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const connId = connRes.rows[0]?.id as string | undefined
    if (!connId) return { error: "No active Substack connection" }

    // Check cooldown / existing pending or recent sync
    const checkRes = await client.query(
      `select last_synced_at
       from sync_state
       where connection_id = $1 and last_synced_at > now() - interval '60 seconds'`,
      [connId]
    )
    if (checkRes.rows.length > 0) {
      return { enqueued: false, message: "Sync was recently performed. Please wait before syncing again." }
    }

    const job = await client.query(
      `insert into jobs (type, payload, status, run_at)
       select 'sync:activity', json_build_object('userId', $1::text, 'connectionId', $2::text), 'pending', now()
       where not exists (
         select 1 from jobs existing
         where existing.type = 'sync:activity'
           and existing.status in ('pending', 'running')
           and existing.payload->>'connectionId' = $2::text
       )
       returning id`,
      [appUser, connId]
    )
    if (!job.rows[0]) {
      return { enqueued: false, message: "A sync job is already in progress or queued." }
    }
    return { enqueued: true, jobId: job.rows[0].id }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})

syncRoutes.post("/sync/subscribers", async (c) => {
  const appUser = c.get("appUser")
  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id, ciphertext, publication_url from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const conn = connRes.rows[0]
    if (!conn) return { error: "No active Substack connection" }

    const pubUrl = (conn.publication_url || "").replace(/\/$/, "")
    if (!pubUrl) return { error: "Publication URL is not set on the active connection" }

    const sessionToken = conn.ciphertext
    let offset = 0
    const limit = 100
    let total = 0
    let totalProcessed = 0
    let totalMatched = 0
    let totalCreated = 0
    let totalSkipped = 0

    const { upsertSubscribersBatch } = await import("../../db/repositories.js")

    while (true) {
      const resp = await fetch(`${pubUrl}/api/v1/subscriber-stats`, {
        method: "POST",
        headers: {
          cookie: `substack.sid=${sessionToken}`,
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({ limit, offset }),
      })

      if (!resp.ok) {
        throw new Error(`Substack subscriber API returned ${resp.status}`)
      }

      const page = parseSubscriberStatsPage(await resp.json())
      total = page.total
      totalSkipped += page.skipped
      if (page.subscribers.length === 0) break

      const batchResult = await upsertSubscribersBatch(client, appUser, page.subscribers)
      totalMatched += batchResult.matched
      totalCreated += batchResult.created
      totalSkipped += batchResult.skipped
      totalProcessed += page.subscribers.length

      offset += page.subscribers.length + page.skipped
      if (offset >= total) break

      await new Promise((r) => setTimeout(r, 100))
    }

    return {
      success: true,
      totalSubscribers: total,
      processed: totalProcessed,
      matched: totalMatched,
      created: totalCreated,
      skipped: totalSkipped,
    }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})

syncRoutes.post("/sync/followers", async (c) => {
  const appUser = c.get("appUser")
  const body = await c.req.json().catch(() => ({}))
  const maxContacts = typeof body.limit === "number"
    ? Math.max(1, Math.min(Math.trunc(body.limit), 100))
    : 50
  const runStartedAt = parseFollowerRunStartedAt(body.runStartedAt)

  const result = await withTenant({ appUserId: appUser }, async (client) => {
    const connRes = await client.query(
      "select id, ciphertext, publication_url from substack_connections where user_id = $1 and status = 'active' order by generation desc limit 1",
      [appUser]
    )
    const conn = connRes.rows[0]
    if (!conn) return { error: "No active Substack connection" }

    const { createSubstackClient } = await import("@workspace/core")
    const sdk = createSubstackClient({
      sessionToken: conn.ciphertext,
      publicationUrl: conn.publication_url,
    })

    const peopleRes = await client.query(
      `select p.id, p.name, p.normalized_handle, p.substack_profile_id
       from people p
       left join relationship_stats s on s.person_id = p.id
       where p.user_id = $1 and p.archived_at is null
         and (p.handle is not null or p.substack_profile_id is not null)
         and (p.follower_checked_at is null or p.follower_checked_at < $3::timestamptz)
       order by p.follower_checked_at asc nulls first,
                coalesce(s.engagement_score, 0) desc,
                p.id
       limit $2`,
      [appUser, maxContacts, runStartedAt.toISOString()]
    )

    let updated = 0
    let failed = 0

    for (const person of peopleRes.rows) {
      try {
        let prof: any = null
        if (person.normalized_handle) {
          prof = await sdk.getPublicProfile(person.normalized_handle)
        } else if (person.substack_profile_id) {
          prof = await sdk.getProfileById(person.substack_profile_id)
        }

        if (prof && typeof prof.followsViewer === "boolean") {
          await client.query(
            `update people
             set is_follower = $2,
                 follower_checked_at = now(),
                 updated_at = now()
             where id = $1`,
            [person.id, prof.followsViewer]
          )
          updated++
        } else {
          failed++
          await client.query(
            "update people set follower_checked_at = now() where id = $1",
            [person.id]
          )
        }
      } catch (error) {
        if (shouldAbortFollowerSweep(error)) throw error
        failed++
        await client.query(
          "update people set follower_checked_at = now() where id = $1",
          [person.id]
        )
      } finally {
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    const progressRes = await client.query(
      `select
         count(*) filter (
           where follower_checked_at is null or follower_checked_at < $2::timestamptz
         )::int as remaining,
         count(*) filter (where is_follower = true)::int as followers
       from people
       where user_id = $1 and archived_at is null
         and (handle is not null or substack_profile_id is not null)`,
      [appUser, runStartedAt.toISOString()]
    )

    return {
      success: true,
      checked: peopleRes.rows.length,
      updated,
      failed,
      followersCount: progressRes.rows[0]?.followers ?? 0,
      remaining: progressRes.rows[0]?.remaining ?? 0,
      runStartedAt: runStartedAt.toISOString(),
    }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})
