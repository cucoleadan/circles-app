import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import { NEWSLETTER_COLD_AFTER_SENDS } from "@workspace/core"
import { withTenant } from "../../db/tenant.js"
import type { V1Env } from "./types.js"

export const newsletterRoutes = new Hono<V1Env>()

const runColumns = `id, status, stage, error, posts, subscribers,
  created_at as "createdAt", finished_at as "finishedAt"`

/** Starts a publication export on Substack; only ever triggered by the user. */
newsletterRoutes.post("/newsletter/exports", async (c) => {
  const userId = c.get("appUser")
  const result = await withTenant({ appUserId: userId }, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('newsletter-export'), hashtext($1))", [userId])
    const running = (await client.query(
      `select ${runColumns} from newsletter_export_runs where user_id = $1 and status = 'running'`,
      [userId],
    )).rows[0]
    if (running) return { run: running }
    const connection = (await client.query(
      `select id from substack_connections where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId],
    )).rows[0]
    if (!connection) return { error: "No active Substack connection" }
    const runId = randomUUID()
    const run = (await client.query(
      `insert into newsletter_export_runs (id, user_id, connection_id, stage)
       values ($1, $2, $3, 'Queued') returning ${runColumns}`,
      [runId, userId, connection.id],
    )).rows[0]
    await client.query(
      `insert into jobs (type, payload, status, max_attempts)
       values ('export:newsletter', $1, 'pending', 3)`,
      [JSON.stringify({ userId, connectionId: connection.id, runId })],
    )
    return { run }
  })
  if ("error" in result) return c.json({ error: result.error }, 409)
  return c.json({ run: result.run }, 202)
})

const signalsQuery = z.object({
  filter: z.enum(["engaged", "cold", "never", "all"]).default("engaged"),
  search: z.string().trim().max(320).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

newsletterRoutes.get("/newsletter/signals", async (c) => {
  const parsed = signalsQuery.safeParse(c.req.query())
  if (!parsed.success) return c.json({ error: "Invalid newsletter filters" }, 400)
  const { filter, search, limit } = parsed.data
  const userId = c.get("appUser")
  return c.json(await withTenant({ appUserId: userId }, async (client) => {
    const run = (await client.query(
      `select ${runColumns} from newsletter_export_runs where user_id = $1 order by created_at desc limit 1`,
      [userId],
    )).rows[0] ?? null
    const lastComplete = (await client.query(
      `select connection_id, finished_at as "finishedAt" from newsletter_export_runs
       where user_id = $1 and status = 'complete' order by finished_at desc limit 1`,
      [userId],
    )).rows[0]
    if (!lastComplete) return { run, calculatedAt: null, coldAfterSends: NEWSLETTER_COLD_AFTER_SENDS, summary: null, posts: [], subscribers: [] }
    const scope = [userId, lastComplete.connection_id]
    const summary = (await client.query(
      `select count(*)::int as "subscribers",
              count(*) filter (where in_email_list)::int as "listed",
              count(*) filter (where delivered > 0 and opened = 0)::int as "neverOpened",
              count(*) filter (where opened > 0 and sends_since_open >= $3)::int as "goingCold",
              (select round(avg(opened::numeric / nullif(delivered, 0)), 4)::float
                 from newsletter_post_signals where user_id = $1 and connection_id = $2 and delivered > 0) as "averageOpenRate"
       from newsletter_subscriber_signals where user_id = $1 and connection_id = $2`,
      [...scope, NEWSLETTER_COLD_AFTER_SENDS],
    )).rows[0]
    const posts = (await client.query(
      `select post_id::text as "postId", title, slug, audience, sent_at as "sentAt", delivered, opened,
              round(opened::numeric / nullif(delivered, 0), 4)::float as "openRate"
       from newsletter_post_signals where user_id = $1 and connection_id = $2
       order by sent_at desc nulls last`,
      scope,
    )).rows
    const where = {
      engaged: "opened > 0 and sends_since_open < $3",
      cold: "opened > 0 and sends_since_open >= $3",
      never: "delivered > 0 and opened = 0",
      all: "true",
    }[filter]
    const order = filter === "cold" ? "last_opened_at desc" : filter === "never" ? "delivered desc" : `opened::numeric / nullif(delivered, 0) desc nulls last, opened desc`
    const subscribers = (await client.query(
      `select email, in_email_list as "inEmailList", active_subscription as "activeSubscription", plan,
              subscribed_at as "subscribedAt", delivered, opened,
              round(opened::numeric / nullif(delivered, 0), 4)::float as "openRate",
              last_opened_at as "lastOpenedAt", last_delivered_at as "lastDeliveredAt",
              sends_since_open as "sendsSinceOpen"
       from newsletter_subscriber_signals
       where user_id = $1 and connection_id = $2 and ${where}
         and ($4::text is null or email ilike '%' || $4 || '%')
       order by ${order}, email
       limit $5`,
      [...scope, NEWSLETTER_COLD_AFTER_SENDS, search || null, limit],
    )).rows
    return { run, calculatedAt: lastComplete.finishedAt, coldAfterSends: NEWSLETTER_COLD_AFTER_SENDS, summary, posts, subscribers }
  }))
})
