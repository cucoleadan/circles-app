import { randomUUID } from "node:crypto"
import { processMcpTool } from "./mcp.js"
import { processContactRefetch } from "./contact-refetch.js"
import { failNewsletterExport, NEWSLETTER_POLL_SECONDS, processNewsletterExport } from "./newsletter.js"
import type { Pool, PoolClient } from "pg"
import type { OutboundStage } from "./history.js"
import { withTenant, substackResponseError, SESSION_EXPIRED_MESSAGE } from "./tenant.js"
import {
  finishImportIfReady,
  processHistoryImport,
} from "./imports.js"
import {
  preserveActivityEvidence,
  processActivitySync,
  processScheduledHistorySync,
  type HistoryStream,
  type ScheduledHistoryStream,
} from "./activity.js"
import {
  processSubscriberSyncPage,
  processFollowingSync,
  recordAudienceImportProgress,
  recordMissingHandleProgress,
  profileHandle,
  processMissingHandleBackfill,
  type IncrementalSubscriberState,
} from "./audience.js"
import {
  processProfileEnrichment,
  processStoredNoteReplay,
  processStoredInteractionEvidence,
} from "./replay.js"

// Re-export all handlers, types, and helpers for backward compatibility
export {
  withTenant,
  substackResponseError,
  finishImportIfReady,
  processHistoryImport,
  preserveActivityEvidence,
  processActivitySync,
  processScheduledHistorySync,
  processSubscriberSyncPage,
  processFollowingSync,
  recordAudienceImportProgress,
  recordMissingHandleProgress,
  profileHandle,
  processMissingHandleBackfill,
  processProfileEnrichment,
  processStoredNoteReplay,
  processStoredInteractionEvidence,
  type HistoryStream,
  type ScheduledHistoryStream,
}

export interface JobHandlers {
  onSync?: (client: PoolClient, userId: string, connectionId: string) => Promise<{ skipped: boolean }>
  onHistorySync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    stream: ScheduledHistoryStream,
    outboundStage?: OutboundStage,
  ) => Promise<{ skipped: boolean }>
  onImport?: (client: PoolClient, userId: string, importRunId: string, stream?: HistoryStream) => Promise<{ completed: boolean }>
  onEnrich?: (client: PoolClient, userId: string, personId: string) => Promise<unknown>
  onContactRefetch?: (client: PoolClient, userId: string, personId: string) => Promise<unknown>
  onSubscriberSync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    offset: number,
    runStartedAt: unknown,
    incremental?: IncrementalSubscriberState | null,
  ) => Promise<any>
  onFollowingSync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
  ) => Promise<any>
  onMissingHandleBackfill?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    afterId?: string | null,
    placeholdersOnly?: boolean,
  ) => Promise<any>
}

function numericSummary(value: unknown, fields: string[]): Record<string, number> {
  if (!value || typeof value !== "object") return {}
  const data = value as Record<string, unknown>
  return Object.fromEntries(fields.flatMap((field) =>
    typeof data[field] === "number" && Number.isFinite(data[field])
      ? [[field, data[field] as number]]
      : []
  ))
}

export async function claimAndRunJob(
  pool: Pool,
  workerId: string,
  handlers?: JobHandlers
): Promise<boolean> {
  const client = await pool.connect()
  try {
    // Reclaim expired leases. The lost run counts as an attempt so a job that
    // repeatedly crashes or hangs the worker eventually dead-letters instead of
    // looping forever. The recurring activity sync is never dead-lettered here.
    await client.query(
      `update jobs
       set status = case
             when attempts >= max_attempts and type <> 'sync:activity' then 'dead'
             else 'pending'
           end,
           run_at = now(),
           last_error = 'Worker lease expired before the job finished',
           updated_at = now()
       where status = 'running' and lease_expires_at < now()`
    )

    // Claim next pending job
    await client.query("begin")
    const claimRes = await client.query(
      `select id, type, payload, attempts, max_attempts
       from jobs
       where status = 'pending' and run_at <= now()
       order by run_at, id
       limit 1
       for update skip locked`
    )

    const job = claimRes.rows[0]
    if (!job) {
      await client.query("commit")
      return false
    }

    const leaseToken = randomUUID()
    await client.query(
      `update jobs
       set status = 'running',
           attempts = attempts + 1,
           locked_at = now(),
           locked_by = $2,
           lease_token = $3,
           lease_expires_at = now() + interval '5 minutes',
           updated_at = now()
       where id = $1`,
      [job.id, workerId, leaseToken]
    )
    await client.query("commit")

    // Execute job
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload
    const {
      userId, connectionId, importRunId, personId, stream, outboundStage,
      offset, runStartedAt, afterId,
    } = payload

    let jobResult: Record<string, number | boolean> | null = null
    // Follow-up jobs (next pages, the next scheduled sync) are queued in the
    // same transaction that marks this job done, and only while this worker
    // still holds the lease, so a crash can never fork a duplicate chain.
    const followUps: Array<{ sql: string; params: unknown[] }> = []
    const enqueue = (sql: string, params: unknown[]) => {
      followUps.push({ sql, params })
    }
    try {
      if (job.type === "sync:activity") {
        const result = handlers?.onSync
          ? await handlers.onSync(client, userId, connectionId)
          : await processActivitySync(client, userId, connectionId)
        jobResult = result.skipped
          ? { skipped: true }
          : numericSummary("stats" in result ? result.stats : null, ["processedItems", "newInteractions", "newPeople"])
        // Notifications are polled every few minutes; the owner's own replies
        // every 30 minutes; reply-tree, Like and restack refreshes at most every
        // 3 hours; audience sweeps once a day.
        const recentHistory = async (stream: string, outboundStage: string, window: string) =>
          Boolean((await client.query(
            `select 1 from jobs
             where type = 'sync:history' and payload->>'connectionId' = $1
               and payload->>'stream' = $2 and coalesce(payload->>'outboundStage', '') = $3
               and created_at > now() - $4::interval
             limit 1`,
            [connectionId, stream, outboundStage, window],
          )).rows[0])
        const refreshDue = !result.skipped && !await recentHistory("owned_notes", "", "3 hours")
        const repliesDue = !result.skipped && !await recentHistory("outbound_actions", "replies", "30 minutes")
        const recentAudience = result.skipped ? null : await client.query(
          `select 1 from jobs
           where type in ('sync:subscribers', 'sync:following')
             and payload->>'connectionId' = $1
             and created_at > now() - interval '23 hours'
           limit 1`,
          [connectionId],
        )
        {
          const scheduledHistory: Array<{
            stream: ScheduledHistoryStream
            outboundStage?: OutboundStage
            delay: number
          }> = [
            ...(refreshDue ? [
              { stream: "owned_notes", delay: 10 },
              { stream: "owned_posts", delay: 20 },
              { stream: "outbound_actions", outboundStage: "likes", delay: 30 },
              { stream: "outbound_actions", outboundStage: "restacks", delay: 40 },
            ] as const : []),
            ...(repliesDue ? [{ stream: "outbound_actions", outboundStage: "replies", delay: 50 }] as const : []),
          ]
          for (const scheduled of scheduledHistory) {
            enqueue(
              `insert into jobs (type, payload, status, run_at)
               select 'sync:history', $1, 'pending', now() + ($2 || ' seconds')::interval
               where not exists (
                 select 1 from jobs existing
                 where existing.type = 'sync:history'
                   and existing.status in ('pending', 'running')
                   and existing.payload->>'connectionId' = $3
                   and existing.payload->>'stream' = $4
                   and coalesce(existing.payload->>'outboundStage', '') = $5
               )`,
              [
                JSON.stringify({ ...payload, parentJobId: String(job.id), stream: scheduled.stream, outboundStage: scheduled.outboundStage }),
                scheduled.delay,
                connectionId,
                scheduled.stream,
                scheduled.outboundStage ?? "",
              ],
            )
          }
        }
        if (!result.skipped && !recentAudience?.rows[0]) {
          // Daily syncs read only new subscribers; one full sweep per week
          // re-reads the whole list so unsubscribes can be reconciled safely.
          // A failed attempt counts too, so a blocked sweep is not retried daily.
          const recentFullSweep = await client.query(
            `select 1 from jobs
             where type = 'sync:subscribers'
               and payload->>'connectionId' = $1
               and coalesce(payload->>'mode', 'full') = 'full'
               and created_at > now() - interval '7 days'
             limit 1`,
            [connectionId],
          )
          const audienceJobs = [
            {
              type: "sync:subscribers",
              delay: 60,
              payload: {
                userId,
                connectionId,
                offset: 0,
                runStartedAt: new Date().toISOString(),
                manual: false,
                mode: recentFullSweep.rows[0] ? "incremental" : "full",
              },
            },
            {
              type: "sync:following",
              delay: 80,
              payload: { userId, connectionId, manual: false },
            },
          ]
          for (const audience of audienceJobs) {
            enqueue(
              `insert into jobs (type, payload, status, run_at)
               select $1, $2, 'pending', now() + ($3 || ' seconds')::interval
               where not exists (
                 select 1 from jobs existing
                 where existing.type = $1
                   and existing.status in ('pending', 'running')
                   and existing.payload->>'connectionId' = $4
               )`,
              [
                audience.type,
                JSON.stringify({ ...audience.payload, parentJobId: String(job.id) }),
                audience.delay,
                connectionId,
              ],
            )
          }
        }
        if (!result.skipped) {
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             select 'sync:activity', $1, 'pending', now() + interval '10 minutes'
             where not exists (
               select 1 from jobs existing
               where existing.type = 'sync:activity'
                 and existing.status in ('pending', 'running')
                 and existing.payload->>'connectionId' = $2
                 and existing.id <> $3
             )`,
            [JSON.stringify(payload), connectionId, job.id]
          )
        }
      } else if (job.type === "sync:history") {
        const result = handlers?.onHistorySync
          ? await handlers.onHistorySync(client, userId, connectionId, stream, outboundStage)
          : await processScheduledHistorySync(client, userId, connectionId, stream, outboundStage)
        jobResult = result.skipped
          ? { skipped: true }
          : numericSummary("stats" in result ? result.stats : null, ["items", "newInteractions", "newPeople"])
        if (result.skipped) {
          console.log(`[Circles Worker] Skipped ${stream} sync for inactive connection ${connectionId}.`)
        }
      } else if (job.type === "sync:subscribers") {
        const incremental: IncrementalSubscriberState | null = payload.mode === "incremental" && !importRunId
          ? { since: payload.since, direction: payload.direction, pages: Number(payload.pages ?? 0) }
          : null
        const result = handlers?.onSubscriberSync
          ? await handlers.onSubscriberSync(client, userId, connectionId, Number(offset ?? 0), runStartedAt, incremental)
          : await processSubscriberSyncPage(client, userId, connectionId, Number(offset ?? 0), runStartedAt, incremental)
        const incrementalPage = result.mode === "incremental"
        const totals = {
          processed: Number(payload.processed ?? 0) + Number(result.processed ?? 0),
          matched: Number(payload.matched ?? 0) + Number(result.matched ?? 0),
          created: Number(payload.created ?? 0) + Number(result.created ?? 0),
          invalid: Number(payload.invalid ?? 0) + Number(result.invalid ?? 0),
          deactivated: Number(payload.deactivated ?? 0) + Number(result.deactivated ?? 0),
        }
        jobResult = result.skipped ? { skipped: true } : { ...totals, completed: Boolean(result.completed) }
        const continueImport = importRunId && stream === "subscribers"
          ? await recordAudienceImportProgress(client, userId, importRunId, stream, result)
          : !result.completed && !result.skipped
        if (continueImport) {
          // Scheduled sweeps run unattended, so space their Substack reads out;
          // manual and import sweeps keep the faster pace the user is waiting on.
          const pageDelay = payload.manual === false && !importRunId ? "30 seconds" : "2 seconds"
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:subscribers', $1, 'pending', now() + $2::interval)`,
            [JSON.stringify({
              ...payload,
              ...(result.mode && { mode: result.mode }),
              ...(incrementalPage && {
                since: result.since,
                direction: result.direction,
                pages: result.pages,
              }),
              offset: result.nextOffset,
              total: result.total,
              runStartedAt: result.runStartedAt ?? runStartedAt,
              ...totals,
            }), pageDelay],
          )
        } else if (!result.skipped) {
          console.log(
            `[Circles Worker] ${incrementalPage ? "Incremental subscriber" : "Subscriber"} sync complete: ` +
              `${totals.processed} processed, ` +
              `${totals.matched} matched, ${totals.created} created, ` +
              `${totals.deactivated} unsubscribed, ${totals.invalid} skipped.`,
          )
        }
      } else if (job.type === "sync:following") {
        const result = handlers?.onFollowingSync
          ? await handlers.onFollowingSync(client, userId, connectionId)
          : await processFollowingSync(client, userId, connectionId)
        if (importRunId && stream === "following") {
          await recordAudienceImportProgress(client, userId, importRunId, stream, result)
        }
        if (!result.skipped) {
          console.log(
            `[Circles Worker] Following sync complete: ${result.checked} checked, ` +
              `${result.updated} followed, ${result.subscribed ?? 0} subscribed, ` +
              `${result.created ?? 0} new contacts.`,
          )
        }
        // The following list is ID-only; resolve names/handles for the contacts it
        // created, not every handle-less subscriber (thousands of profile reads).
        if (!result.skipped && (result.created ?? 0) > 0) {
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             select 'enrich:missing-handles', $1::jsonb, 'pending', now() + interval '1 minute'
             where not exists (select 1 from jobs where type = 'enrich:missing-handles'
               and status in ('pending', 'running') and payload->>'connectionId' = $2)`,
            [JSON.stringify({ userId, connectionId, placeholdersOnly: true }), connectionId],
          )
        }
        jobResult = result.skipped
          ? { skipped: true }
          : numericSummary(result, ["checked", "updated", "subscribed", "created", "failed"])
      } else if (job.type === "enrich:missing-handles") {
        const result = handlers?.onMissingHandleBackfill
          ? await handlers.onMissingHandleBackfill(client, userId, connectionId, afterId, payload.placeholdersOnly === true)
          : await processMissingHandleBackfill(client, userId, connectionId, afterId, payload.placeholdersOnly === true)
        const keepGoing = importRunId
          ? await recordMissingHandleProgress(client, userId, importRunId, result)
          : !result.completed && !result.skipped
        if (keepGoing) {
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             values ('enrich:missing-handles', $1, 'pending', now() + interval '2 seconds')`,
            [JSON.stringify({ ...payload, afterId: result.afterId })],
          )
        }
      } else if (job.type === "import:history") {
        const result = handlers?.onImport
          ? await handlers.onImport(client, userId, importRunId, stream)
          : await processHistoryImport(client, userId, importRunId, stream)
        if (!result.completed) {
          // Keep pages small and spaced out; other streams share the same
          // authenticated Substack session and are interleaved by this queue.
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             select 'import:history', $1, 'pending', now() + interval '2 seconds'
             where exists (
               select 1 from import_runs
               where id = $2 and status = 'running'
             )`,
            [JSON.stringify(payload), importRunId]
          )
        }
      } else if (job.type === "enrich:profile") {
        if (handlers?.onEnrich) {
          await handlers.onEnrich(client, userId, personId)
        } else {
          await processProfileEnrichment(client, userId, personId)
        }
      } else if (job.type === "refetch:contact") {
        if (handlers?.onContactRefetch) {
          await handlers.onContactRefetch(client, userId, personId)
        } else {
          await processContactRefetch(client, userId, personId)
        }
      } else if (job.type === "reprocess:note-snapshots") {
        const result = await processStoredNoteReplay(
          client,
          userId,
          connectionId,
          payload.afterNoteId ?? null,
        )
        if (!result.completed) {
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             values ('reprocess:note-snapshots', $1, 'pending', now() + interval '10 seconds')`,
            [JSON.stringify({ ...payload, afterNoteId: result.nextCursor })],
          )
        }
      } else if (job.type === "reprocess:interaction-evidence") {
        const result = await processStoredInteractionEvidence(
          client,
          userId,
          connectionId,
          {
            activityDone: payload.activityDone === true,
            afterReceivedAt: payload.afterReceivedAt ?? null,
            afterBatchId: payload.afterBatchId ?? null,
          },
        )
        if (!result.completed && result.cursor) {
          enqueue(
            `insert into jobs (type, payload, status, run_at)
             values ('reprocess:interaction-evidence', $1, 'pending', now() + interval '1 second')`,
            [JSON.stringify({ ...payload, ...result.cursor })],
          )
        }
      } else if (job.type === "mcp:substack") {
        jobResult = await processMcpTool(client, userId, payload.runId)
      } else if (job.type === "export:newsletter") {
        const step = await processNewsletterExport(
          client, userId, connectionId, payload.runId, payload.exportId ?? null, Number(payload.polls ?? 0),
        )
        if (step.done) {
          jobResult = numericSummary(step, ["posts", "subscribers"])
        } else {
          enqueue(
            `insert into jobs (type, payload, status, run_at, max_attempts)
             values ('export:newsletter', $1, 'pending', now() + ($2 || ' seconds')::interval, 3)`,
            [JSON.stringify({ ...payload, exportId: step.exportId, polls: step.polls }), NEWSLETTER_POLL_SECONDS],
          )
        }
      } else {
        throw new Error(`Unknown job type: ${job.type}`)
      }

      // Mark job done and queue its follow-ups atomically.
      await client.query("begin")
      try {
        if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId])
        const done = await client.query(
          "update jobs set status = 'done', last_error = null, result = $3::jsonb, updated_at = now() where id = $1 and lease_token = $2",
          [job.id, leaseToken, jobResult ? JSON.stringify(jobResult) : null]
        )
        if (done.rowCount !== 0) {
          for (const followUp of followUps) await client.query(followUp.sql, followUp.params)
        } else {
          console.warn(`[Circles Worker] Job ${job.id} lost its lease; skipped ${followUps.length} follow-up jobs.`)
        }
        await client.query("commit")
      } catch (completionError) {
        await client.query("rollback")
        throw completionError
      }
    } catch (jobError: any) {
      console.error(
        `[Circles Worker] Job ${job.id} (${job.type}) failed:`,
        jobError?.message,
        jobError?.url ? `(url: ${jobError.url})` : "",
        jobError?.detail ? `(detail: ${jobError.detail})` : "",
      )
      const errorMessage = String(jobError?.message || "Unknown worker error")
      const isUnauthorized = jobError?.status === 401 ||
        jobError?.statusCode === 401 ||
        /\b401\b/.test(errorMessage)
      // A private or unavailable profile can reject optional handle lookup
      // even while the connection's main activity endpoint remains valid.
      const optionalProfileUnauthorized = isUnauthorized &&
        (job.type === "enrich:missing-handles" || job.type === "refetch:contact")
      // Only an upstream 401 (or this worker's own expiry error) proves the
      // session is dead. Matching the word "expired" anywhere would also catch
      // unrelated failures such as an expired TLS certificate.
      const sessionExpired = (isUnauthorized && !optionalProfileUnauthorized) ||
        errorMessage === SESSION_EXPIRED_MESSAGE
      // Substack's Cloudflare edge answers bursts with a 403 challenge page;
      // treat it like a rate limit on sync/import work and back off.
      const isUpstreamChallenge = /^(sync|import):/.test(job.type) && (
        jobError?.status === 403 || jobError?.statusCode === 403 || /\b403\b/.test(errorMessage)
      )
      const isAudienceDenied = isUpstreamChallenge && job.type === "sync:following"
      const failureMessage = sessionExpired
        ? SESSION_EXPIRED_MESSAGE
        : isAudienceDenied
          ? "Substack temporarily rejected the audience request"
          : isUpstreamChallenge
            ? "Substack temporarily rejected the request"
            : errorMessage

      // The request transaction has already rolled back at this point, so
      // persist expiry in a fresh tenant transaction instead of losing it.
      if (sessionExpired && userId && connectionId) {
        try {
          await withTenant(client, userId, async () => {
            await client.query(
              "update substack_connections set status = 'expired', updated_at = now() where id = $1",
              [connectionId],
            )
            await client.query(
              "update sync_state set status = 'error', error = 'Substack session expired', updated_at = now() where connection_id = $1",
              [connectionId],
            )
          })
        } catch (expiryError: any) {
          console.error(
            `[Circles Worker] Could not persist expired status for connection ${connectionId}:`,
            expiryError?.message,
          )
        }
      }
      const isRateLimited = jobError?.status === 429 ||
        jobError?.statusCode === 429 ||
        /\b429\b/.test(errorMessage) || isUpstreamChallenge
      // The recurring activity sync owns the polling schedule; dead-lettering it
      // would silently stop all syncing, so it backs off and keeps retrying.
      const keepsRetrying = job.type === "sync:activity"
      const isDead = sessionExpired || optionalProfileUnauthorized || job.type === "refetch:contact" || (
        !keepsRetrying &&
        (!isRateLimited || isUpstreamChallenge) &&
        job.attempts + 1 >= job.max_attempts
      )

      if (isDead) {
        await client.query(
          "update jobs set status = 'dead', last_error = $2, updated_at = now() where id = $1",
          [job.id, failureMessage]
        )
        if (job.type === "export:newsletter" && userId && payload.runId) {
          await failNewsletterExport(client, userId, payload.runId, failureMessage)
        }
        if (importRunId && stream && userId) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update import_run_streams
               set status = 'failed', finish_reason = $4, error = $3, updated_at = now()
               where import_run_id = $1 and stream = $2 and status = 'running'`,
              [
                importRunId,
                stream ?? "activity",
                failureMessage,
                sessionExpired ? "session_expired" : "retry_limit",
              ],
            )
            await finishImportIfReady(client, importRunId)
          })
        }
      } else {
        const retryDelaySeconds = isRateLimited || keepsRetrying
          ? Math.min(1800, 60 * (2 ** Math.min(job.attempts, 5)))
          : Math.min(300, (job.attempts + 1) * 30)
        await client.query(
          `update jobs
           set status = 'pending',
               run_at = now() + ($2 || ' seconds')::interval,
               last_error = $3,
               updated_at = now()
           where id = $1`,
          [job.id, retryDelaySeconds, failureMessage]
        )
        if (importRunId && stream && userId) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update import_run_streams
               set error = $3, updated_at = now()
               where import_run_id = $1 and stream = $2 and status = 'running'`,
              [
                importRunId,
                stream ?? "activity",
                isRateLimited
                  ? `${isAudienceDenied ? "Substack temporarily rejected the request" : "Substack rate limit"}; retrying in ${retryDelaySeconds} seconds`
                  : failureMessage,
              ],
            )
          })
        } else if (job.type === "sync:history" && userId && connectionId && stream) {
          await withTenant(client, userId, async () => {
            await client.query(
              `update sync_stream_state
               set status = 'error', error = $3, updated_at = now()
               where connection_id = $1 and stream = $2`,
              [
                connectionId,
                stream,
                isRateLimited
                  ? `Substack rate limit; retrying in ${retryDelaySeconds} seconds`
                  : failureMessage,
              ],
            )
          })
        }
      }
    }

    return true
  } finally {
    client.release()
  }
}
