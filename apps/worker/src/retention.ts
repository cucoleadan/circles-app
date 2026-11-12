import type { PoolClient } from "pg"
import { PROFILE_CONTENT_MAX_DAYS } from "@workspace/core"
import { withTenant } from "./tenant.js"

/**
 * Raw sync evidence (`ingestion_batches`) exists so a parser fix can replay
 * recent pages. Every activity poll adds ~100 kB, so it is kept this long and
 * no longer; interactions already derived from older evidence are unaffected.
 */
export const EVIDENCE_RETENTION_DAYS = 30
/** Agent SDK read results are only served from cache for 6 hours. */
export const MCP_RUN_RETENTION_DAYS = 7
/** Rows deleted per statement, so no transaction holds a large delete. */
const BATCH_ROWS = 200
/** Statements per table in one job run; more work continues in a follow-up job. */
const MAX_BATCHES = 25

interface Rule {
  name: "evidence" | "agentReads" | "profileContent" | "profileState"
  /** Deletes up to $1 expired rows; $2 is the rule's retention in days. */
  sql: string
  days: number
}

const RULES: Rule[] = [
  {
    name: "evidence",
    days: EVIDENCE_RETENTION_DAYS,
    sql: `delete from ingestion_batches where id in (
            select id from ingestion_batches
            where received_at < now() - make_interval(days => $2) limit $1)`,
  },
  {
    name: "agentReads",
    days: MCP_RUN_RETENTION_DAYS,
    sql: `delete from mcp_tool_runs where id in (
            select id from mcp_tool_runs
            where coalesce(finished_at, created_at) < now() - make_interval(days => $2) limit $1)`,
  },
  {
    // saveProfileContent prunes a profile when it is read again; this covers
    // profiles nobody reads any more.
    name: "profileContent",
    days: PROFILE_CONTENT_MAX_DAYS,
    sql: `delete from profile_content where id in (
            select id from profile_content
            where coalesce(published_at, created_at) < now() - make_interval(days => $2) limit $1)`,
  },
  {
    // Fetch checkpoints of profiles that are no longer watched and hold nothing.
    name: "profileState",
    days: PROFILE_CONTENT_MAX_DAYS,
    sql: `delete from profile_content_state where (user_id, substack_profile_id) in (
            select s.user_id, s.substack_profile_id from profile_content_state s
            where s.updated_at < now() - make_interval(days => $2)
              and not exists (select 1 from profile_content c
                where c.user_id = s.user_id and c.substack_profile_id = s.substack_profile_id)
              and not exists (select 1 from people p
                join list_members lm on lm.person_id = p.id
                join lists l on l.id = lm.list_id and l.system_key = 'watched'
                where p.user_id = s.user_id and p.substack_profile_id = s.substack_profile_id)
            limit $1)`,
  },
]

/**
 * Deletes one tenant's expired rows in small batches. `completed` is false
 * when a table still has expired rows after this run's batch budget.
 */
export async function processRetentionCleanup(client: PoolClient, userId: string) {
  const deleted: Record<Rule["name"], number> = { evidence: 0, agentReads: 0, profileContent: 0, profileState: 0 }
  let completed = true
  for (const rule of RULES) {
    for (let batch = 0; ; batch++) {
      if (batch >= MAX_BATCHES) { completed = false; break }
      const removed = await withTenant(client, userId, async () =>
        (await client.query(rule.sql, [BATCH_ROWS, rule.days])).rowCount ?? 0)
      deleted[rule.name] += removed
      if (removed < BATCH_ROWS) break
    }
  }
  return { ...deleted, completed }
}
