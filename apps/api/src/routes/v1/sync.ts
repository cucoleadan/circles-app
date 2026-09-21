import { Hono } from "hono"

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
    let totalMatched = 0
    let totalCreated = 0

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
        const text = await resp.text().catch(() => "")
        throw new Error(`Substack subscriber API returned ${resp.status}: ${text.slice(0, 100)}`)
      }

      const data = await resp.json()
      total = data.total ?? total
      const users = Array.isArray(data.users) ? data.users : []
      if (users.length === 0) break

      const subscribers = users.map((u: any) => ({
        id: u.user_id,
        name: u.user_name,
        photo_url: u.user_photo_url,
        handle: u.user_handle ?? null,
        subscription_type: u.subscription_type,
        subscription_created_at: u.subscription_created_at,
        is_subscribed: u.is_subscribed !== false,
      }))

      const batchResult = await upsertSubscribersBatch(client, appUser, subscribers)
      totalMatched += batchResult.matched
      totalCreated += batchResult.created

      offset += users.length
      if (offset >= total) break

      await new Promise((r) => setTimeout(r, 100))
    }

    return {
      success: true,
      totalSubscribers: total,
      matched: totalMatched,
      created: totalCreated,
    }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})

syncRoutes.post("/sync/followers", async (c) => {
  const appUser = c.get("appUser")
  const body = await c.req.json().catch(() => ({}))
  const maxContacts = typeof body.limit === "number" ? Math.min(body.limit, 100) : 50

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
      `select p.id, p.name, p.handle, p.substack_profile_id
       from people p
       left join relationship_stats s on s.person_id = p.id
       where p.user_id = $1 and p.archived_at is null
         and (p.handle is not null or p.substack_profile_id is not null)
       order by case when p.is_follower is null then 0 else 1 end,
                coalesce(s.engagement_score, 0) desc,
                p.updated_at desc
       limit $2`,
      [appUser, maxContacts]
    )

    let updated = 0
    let followersCount = 0

    for (const person of peopleRes.rows) {
      try {
        let prof: any = null
        if (person.handle) {
          prof = await sdk.getPublicProfile(person.handle)
        } else if (person.substack_profile_id) {
          prof = await sdk.getProfileById(person.substack_profile_id)
        }

        if (prof && typeof prof.followsViewer === "boolean") {
          await client.query(
            `update people
             set is_follower = $2,
                 updated_at = now()
             where id = $1`,
            [person.id, prof.followsViewer]
          )
          updated++
          if (prof.followsViewer) followersCount++
        }
        await new Promise((r) => setTimeout(r, 100))
      } catch {
        // Skip individual errors
      }
    }

    return {
      success: true,
      checked: peopleRes.rows.length,
      updated,
      followersCount,
    }
  })

  if ("error" in result) return c.json(result, 400)
  return c.json(result)
})
