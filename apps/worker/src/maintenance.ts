import type { Pool } from "pg"

export const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000
/** Finished jobs kept for progress panels, sweep scheduling, and debugging. */
const DONE_JOB_RETENTION_DAYS = 14
const DEAD_JOB_RETENTION_DAYS = 30

/**
 * Keeps the queue healthy: restarts the recurring sync for any active
 * connection that lost its job chain, and prunes old finished jobs so the
 * queue table does not grow without bound.
 */
export async function runQueueMaintenance(pool: Pool) {
  const client = await pool.connect()
  try {
    const seeded = await client.query("select seed_missing_activity_syncs() as seeded")
    const count = Number(seeded.rows[0]?.seeded ?? 0)
    if (count > 0) {
      console.log(`[Circles Worker] Restarted the scheduled sync for ${count} connection(s).`)
    }
    const pruned = await client.query(
      `delete from jobs
       where (status = 'done' and updated_at < now() - make_interval(days => $1))
          or (status = 'dead' and updated_at < now() - make_interval(days => $2))`,
      [DONE_JOB_RETENTION_DAYS, DEAD_JOB_RETENTION_DAYS],
    )
    if (pruned.rowCount) console.log(`[Circles Worker] Pruned ${pruned.rowCount} finished jobs.`)
  } catch (error: any) {
    // Maintenance must never stop the queue loop.
    console.error("[Circles Worker] Queue maintenance failed:", error?.message ?? error)
  } finally {
    client.release()
  }
}
