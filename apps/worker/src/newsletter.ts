import type { PoolClient } from "pg"
import {
  computeNewsletterSignals,
  isNewsletterSignalsFile,
  openSessionToken,
  readZipEntries,
} from "@workspace/core"
import { withTenant, substackResponseError } from "./tenant.js"

export const NEWSLETTER_POLL_SECONDS = 20
/** About 20 minutes of polling before the run is reported as failed. */
export const NEWSLETTER_MAX_POLLS = 60
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

export type NewsletterExportStep =
  | { done: true; skipped?: boolean; posts?: number; subscribers?: number }
  | { done: false; exportId: string; polls: number }

async function setRun(client: PoolClient, userId: string, runId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields)
  await withTenant(client, userId, () => client.query(
    `update newsletter_export_runs set ${keys.map((key, i) => `${key} = $${i + 2}`).join(", ")}
     where id = $1 and status = 'running'`,
    [runId, ...keys.map((key) => fields[key])],
  ))
}

export async function failNewsletterExport(client: PoolClient, userId: string, runId: string, error: string) {
  await setRun(client, userId, runId, { status: "failed", error, finished_at: new Date() })
}

/**
 * One step of a user-requested publication export: create it on Substack,
 * poll until Substack finishes it, then download the zip and replace this
 * connection's Newsletter Signals. Never scheduled; only the API queues it.
 */
export async function processNewsletterExport(
  client: PoolClient,
  userId: string,
  connectionId: string,
  runId: string,
  exportId: string | null,
  polls: number,
): Promise<NewsletterExportStep> {
  const { conn, run } = await withTenant(client, userId, async () => ({
    conn: (await client.query(
      `select key_id, iv, ciphertext, publication_url, status
       from substack_connections where id = $1 and user_id = $2`,
      [connectionId, userId],
    )).rows[0],
    run: (await client.query(
      "select status from newsletter_export_runs where id = $1",
      [runId],
    )).rows[0],
  }))
  if (run?.status !== "running") return { done: true, skipped: true }
  if (!conn || conn.status !== "active") {
    await failNewsletterExport(client, userId, runId, "The Substack connection is no longer active")
    return { done: true, skipped: true }
  }
  const publicationUrl = String(conn.publication_url ?? "").replace(/\/$/, "")
  if (!publicationUrl) {
    await failNewsletterExport(client, userId, runId, "Publication URL is not set on the active connection")
    return { done: true, skipped: true }
  }
  const headers = { cookie: `substack.sid=${openSessionToken(conn)}`, "user-agent": USER_AGENT }

  if (!exportId) {
    const created = await fetch(`${publicationUrl}/api/v1/publication_export`, { method: "POST", headers })
    if (!created.ok) throw substackResponseError("Substack export request failed", created.status)
    const body = await created.json() as { id?: unknown; stage?: unknown }
    if (typeof body.id !== "string" || !body.id) throw new Error("Substack did not return an export ID")
    await setRun(client, userId, runId, { substack_export_id: body.id, stage: String(body.stage ?? "Starting") })
    return { done: false, exportId: body.id, polls: 0 }
  }

  const listed = await fetch(`${publicationUrl}/api/v1/publication_export`, { headers })
  if (!listed.ok) throw substackResponseError("Substack export status failed", listed.status)
  const exports = await listed.json() as Array<{ id?: unknown; stage?: unknown; url?: unknown; finished_at?: unknown }>
  const current = Array.isArray(exports) ? exports.find((item) => item.id === exportId) : undefined
  if (!current) throw new Error("Substack no longer lists this export")
  if (typeof current.url !== "string" || !current.finished_at) {
    if (polls + 1 >= NEWSLETTER_MAX_POLLS) {
      await failNewsletterExport(client, userId, runId, "Substack did not finish the export in time")
      return { done: true }
    }
    await setRun(client, userId, runId, { stage: String(current.stage ?? "Exporting") })
    return { done: false, exportId, polls: polls + 1 }
  }

  await setRun(client, userId, runId, { stage: "Downloading" })
  // The file route redirects to a presigned storage URL; follow it without the
  // session cookie so it is never sent to a third-party host.
  const fileUrl = new URL(current.url, publicationUrl)
  if (fileUrl.origin !== new URL(publicationUrl).origin) throw new Error("Unexpected export file host")
  const redirect = await fetch(fileUrl, { headers, redirect: "manual" })
  const location = redirect.headers.get("location")
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  const file = location
    ? await fetch(new URL(location, fileUrl), { signal })
    : redirect.ok ? redirect : null
  if (!file?.ok) throw substackResponseError("Substack export download failed", file?.status ?? redirect.status)
  const entries = readZipEntries(Buffer.from(await file.arrayBuffer()), isNewsletterSignalsFile)
  const { posts, subscribers } = computeNewsletterSignals(
    new Map([...entries].map(([name, data]) => [name, data.toString("utf8")])),
  )

  await withTenant(client, userId, async () => {
    await client.query("delete from newsletter_post_signals where user_id = $1 and connection_id = $2", [userId, connectionId])
    await client.query("delete from newsletter_subscriber_signals where user_id = $1 and connection_id = $2", [userId, connectionId])
    await client.query(
      `insert into newsletter_post_signals
         (user_id, connection_id, post_id, title, slug, audience, sent_at, delivered, opened)
       select $1, $2, * from unnest($3::bigint[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::int[], $9::int[])`,
      [userId, connectionId,
        posts.map((p) => p.postId), posts.map((p) => p.title), posts.map((p) => p.slug), posts.map((p) => p.audience),
        posts.map((p) => p.sentAt), posts.map((p) => p.delivered), posts.map((p) => p.opened)],
    )
    await client.query(
      `insert into newsletter_subscriber_signals
         (user_id, connection_id, email, in_email_list, active_subscription, plan, subscribed_at,
          delivered, opened, last_opened_at, last_delivered_at, sends_since_open)
       select $1, $2, * from unnest($3::text[], $4::boolean[], $5::boolean[], $6::text[], $7::timestamptz[],
         $8::int[], $9::int[], $10::timestamptz[], $11::timestamptz[], $12::int[])`,
      [userId, connectionId,
        subscribers.map((s) => s.email), subscribers.map((s) => s.inEmailList), subscribers.map((s) => s.activeSubscription),
        subscribers.map((s) => s.plan), subscribers.map((s) => s.subscribedAt), subscribers.map((s) => s.delivered),
        subscribers.map((s) => s.opened), subscribers.map((s) => s.lastOpenedAt), subscribers.map((s) => s.lastDeliveredAt),
        subscribers.map((s) => s.sendsSinceOpen)],
    )
    await client.query(
      `update newsletter_export_runs
       set status = 'complete', stage = 'Finished', error = null, posts = $2, subscribers = $3, finished_at = now()
       where id = $1 and status = 'running'`,
      [runId, posts.length, subscribers.length],
    )
  })
  return { done: true, posts: posts.length, subscribers: subscribers.length }
}
