import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import type { OutboundStage } from "./history.js"
import { withTenant, substackResponseError } from "./tenant.js"
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
  processFollowerSyncBatch,
  processFollowingSync,
  recordAudienceImportProgress,
  recordMissingHandleProgress,
  profileHandle,
  processMissingHandleBackfill,
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
  processFollowerSyncBatch,
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
  onSubscriberSync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    offset: number,
    runStartedAt: unknown,
  ) => Promise<any>
  onFollowerSync?: (
    client: PoolClient,
    userId: string,
    connectionId: string,
    runStartedAt: unknown,
    limit: number,
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
  ) => Promise<any>
}

export async function claimAndRunJob(
  pool: Pool,
  workerId: string,
  handlers?: JobHandlers
): Promise<boolean> {
  const client = await pool.connect()
  try {
    // Reset expired leases
    await client.query(
      `update jobs
       set status = 'pending', run_at = now()
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
      offset, runStartedAt, fullSweep, limit, afterId,
    } = payload

    try {
      if (job.type === "sync:activity") {
        const result = handlers?.onSync
          ? await handlers.onSync(client, userId, connectionId)
          : await processActivitySync(client, userId, connectionId)
        if (!result.skipped) {
          const scheduledHistory: Array<{
            stream: ScheduledHistoryStream
            outboundStage?: OutboundStage
            delay: number
          }> = [
            { stream: "owned_notes", delay: 10 },
            { stream: "owned_posts", delay: 20 },
            { stream: "outbound_actions", outboundStage: "likes", delay: 30 },
            { stream: "outbound_actions", outboundStage: "restacks", delay: 40 },
            { stream: "outbound_actions", outboundStage: "replies", delay: 50 },
          ]
          for (const scheduled of scheduledHistory) {
            await client.query(
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
                JSON.stringify({ ...payload, stream: scheduled.stream, outboundStage: scheduled.outboundStage }),
                scheduled.delay,
                connectionId,
                scheduled.stream,
                scheduled.outboundStage ?? "",
              ],
            )
          }
          const audienceJobs = [
            {
              type: "sync:followers",
              delay: 60,
              payload: {
                userId,
                connectionId,
                runStartedAt: new Date().toISOString(),
                fullSweep: false,
                manual: false,
                limit: 50,
              },
            },
            {
              type: "sync:following",
              delay: 70,
              payload: { userId, connectionId, manual: false },
            },
          ]
          for (const audience of audienceJobs) {
            await client.query(
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
                JSON.stringify(audience.payload),
                audience.delay,
                connectionId,
              ],
            )
          }
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             select 'sync:activity', $1, 'pending', now() + interval '3 hours'
             where not exists (
               select 1 from jobs existing
               where existing.type = 'sync:activity'
                 and existing.status in ('pending', 'running')
                 and existing.payload->>'connectionId' = $2
             )`,
            [JSON.stringify(payload), connectionId]
          )
        }
      } else if (job.type === "sync:history") {
        const result = handlers?.onHistorySync
          ? await handlers.onHistorySync(client, userId, connectionId, stream, outboundStage)
          : await processScheduledHistorySync(client, userId, connectionId, stream, outboundStage)
        if (result.skipped) {
          console.log(`[Circles Worker] Skipped ${stream} sync for inactive connection ${connectionId}.`)
        }
      } else if (job.type === "sync:subscribers") {
        const result = handlers?.onSubscriberSync
          ? await handlers.onSubscriberSync(client, userId, connectionId, Number(offset ?? 0), runStartedAt)
          : await processSubscriberSyncPage(client, userId, connectionId, Number(offset ?? 0), runStartedAt)
        const totals = {
          processed: Number(payload.processed ?? 0) + Number(result.processed ?? 0),
          matched: Number(payload.matched ?? 0) + Number(result.matched ?? 0),
          created: Number(payload.created ?? 0) + Number(result.created ?? 0),
          invalid: Number(payload.invalid ?? 0) + Number(result.invalid ?? 0),
          deactivated: Number(payload.deactivated ?? 0) + Number(result.deactivated ?? 0),
        }
        const continueImport = importRunId && stream === "subscribers"
          ? await recordAudienceImportProgress(client, userId, importRunId, stream, result)
          : !result.completed && !result.skipped
        if (continueImport) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:subscribers', $1, 'pending', now() + interval '2 seconds')`,
            [JSON.stringify({
              ...payload,
              offset: result.nextOffset,
              total: result.total,
              runStartedAt: result.runStartedAt ?? runStartedAt,
              ...totals,
            })],
          )
        } else if (!result.skipped) {
          console.log(
            `[Circles Worker] Subscriber sync complete: ${totals.processed} processed, ` +
              `${totals.matched} matched, ${totals.created} created, ` +
              `${totals.deactivated} unsubscribed, ${totals.invalid} skipped.`,
          )
        }
      } else if (job.type === "sync:followers") {
        const result = handlers?.onFollowerSync
          ? await handlers.onFollowerSync(client, userId, connectionId, runStartedAt, Number(limit ?? 20))
          : await processFollowerSyncBatch(client, userId, connectionId, runStartedAt, Number(limit ?? 20))
        const totals = {
          checked: Number(payload.checked ?? 0) + Number(result.checked ?? 0),
          updated: Number(payload.updated ?? 0) + Number(result.updated ?? 0),
          failed: Number(payload.failed ?? 0) + Number(result.failed ?? 0),
        }
        const continueImport = importRunId && stream === "followers"
          ? await recordAudienceImportProgress(client, userId, importRunId, stream, result)
          : fullSweep === true && !result.completed && !result.skipped
        if (continueImport) {
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('sync:followers', $1, 'pending', now() + interval '5 seconds')`,
            [JSON.stringify({
              ...payload,
              runStartedAt: result.runStartedAt ?? runStartedAt,
              ...totals,
            })],
          )
        } else if (!result.skipped) {
          console.log(
            `[Circles Worker] Follower sync ${fullSweep === true ? "complete" : "batch complete"}: ` +
              `${totals.checked} checked, ${totals.updated} updated, ${totals.failed} unverifiable.`,
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
              `${result.updated} followed, ${result.subscribed ?? 0} subscribed.`,
          )
        }
      } else if (job.type === "enrich:missing-handles") {
        const result = handlers?.onMissingHandleBackfill
          ? await handlers.onMissingHandleBackfill(client, userId, connectionId, afterId)
          : await processMissingHandleBackfill(client, userId, connectionId, afterId)
        const keepGoing = await recordMissingHandleProgress(client, userId, importRunId, result)
        if (keepGoing) {
          await client.query(
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
          await withTenant(client, userId, async () => {
            await client.query(
              `insert into jobs (type, payload, status, run_at)
               select 'import:history', $1, 'pending', now() + interval '2 seconds'
               where exists (
                 select 1 from import_runs
                 where id = $2 and status = 'running'
               )`,
              [JSON.stringify(payload), importRunId]
            )
          })
        }
      } else if (job.type === "enrich:profile") {
        if (handlers?.onEnrich) {
          await handlers.onEnrich(client, userId, personId)
        } else {
          await processProfileEnrichment(client, userId, personId)
        }
      } else if (job.type === "reprocess:note-snapshots") {
        const result = await processStoredNoteReplay(
          client,
          userId,
          connectionId,
          payload.afterNoteId ?? null,
        )
        if (!result.completed) {
          await client.query(
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
          await client.query(
            `insert into jobs (type, payload, status, run_at)
             values ('reprocess:interaction-evidence', $1, 'pending', now() + interval '1 second')`,
            [JSON.stringify({ ...payload, ...result.cursor })],
          )
        }
      } else {
        throw new Error(`Unknown job type: ${job.type}`)
      }

      // Mark job done
      await client.query(
        "update jobs set status = 'done', last_error = null, updated_at = now() where id = $1 and lease_token = $2",
        [job.id, leaseToken]
      )
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
      const sessionExpired = isUnauthorized || /\bexpired\b/i.test(errorMessage)
      const isAudienceDenied = (
        job.type === "sync:followers" || job.type === "sync:following"
      ) && (
        jobError?.status === 403 || jobError?.statusCode === 403 || /\b403\b/.test(errorMessage)
      )
      const failureMessage = sessionExpired
        ? "Substack session expired"
        : isAudienceDenied
          ? "Substack temporarily rejected the audience request"
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
        errorMessage.includes("429") || isAudienceDenied
      const isDead = (
        !isRateLimited && job.attempts + 1 >= job.max_attempts
      ) || sessionExpired

      if (isDead) {
        await client.query(
          "update jobs set status = 'dead', last_error = $2, updated_at = now() where id = $1",
          [job.id, failureMessage]
        )
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
        const retryDelaySeconds = isRateLimited
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
