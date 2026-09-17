// D1 -> PostgreSQL converter for the Circles CRM rebuild (plan section 7).
//
// Input: JSON table exports produced by d1-export.sh (wrangler d1 execute
// --json), one file per source table. Output: imported rows plus a
// reconciliation report and a quarantine list for anything that cannot be
// converted losslessly.
//
// Usage (from the repo root, tunnel up):
//   bun --env-file=.env scripts/migration/d1-convert.ts --dir=scripts/migration/exports
//   bun --env-file=.env scripts/migration/d1-convert.ts --dir=scripts/migration/fixtures --database=circles_test
//
// Connects as circles_migrate (table owner) so imports bypass row level
// security by design; only migration tooling should ever use that role.

import { randomUUID } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { Pool } from "pg"

interface SourceRow {
  [key: string]: unknown
}

const timestamp = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const epochMillis = (value: unknown): string | null => {
  if (typeof value !== "number" || value <= 0) return null
  return new Date(value).toISOString()
}

const jsonValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return null
  if (typeof value === "object") return value
  try {
    return JSON.parse(String(value))
  } catch {
    return undefined // invalid JSON marker
  }
}

const jsonb = (value: unknown): string | null => {
  const parsed = jsonValue(value)
  return parsed === null || parsed === undefined ? null : JSON.stringify(parsed)
}

function loadTable(rows: SourceRow[]): SourceRow[] {
  // wrangler --json wraps results; raw arrays are also accepted
  const wrapped = rows as { results?: SourceRow[] }[]
  if (Array.isArray(rows) && rows.length > 0 && wrapped[0]?.results)
    return wrapped[0].results
  return rows
}

async function readExports(dir: string) {
  const tables: Record<string, SourceRow[]> = {}
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const name = file.replace(".json", "")
    const raw = JSON.parse(await readFile(`${dir}/${file}`, "utf8"))
    tables[name] = Array.isArray(raw) ? loadTable(raw) : []
  }
  return tables
}

async function main() {
  const args = new Map(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=")
      return [key, value]
    })
  )
  const dir = args.get("dir") ?? "scripts/migration/exports"
  const database = args.get("database")

  const adminUrl = new URL(
    process.env.DATABASE_URL ??
      (() => {
        throw new Error("DATABASE_URL is required (see .env)")
      })()
  )
  if (database) adminUrl.pathname = `/${database}`
  adminUrl.username = "circles_migrate"
  adminUrl.password = process.env.MIGRATE_DB_PASSWORD ?? ""
  if (!adminUrl.password) throw new Error("MIGRATE_DB_PASSWORD is required")

  const tables = await readExports(dir)
  const db = new Pool({ connectionString: adminUrl.toString(), max: 1 })
  console.log(`converting ${dir} -> ${adminUrl.pathname.slice(1)}`)

  // Legacy outbound evidence stays separate with provenance (plan section 7):
  // never merged into interactions without proven identity.
  await db.query(`create table if not exists legacy_engagements (
    id text primary key,
    user_id text not null references app_users (id) on delete cascade,
    person_id text,
    target_id text not null,
    target_type text not null,
    action_type text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null,
    imported_at timestamptz not null default now()
  )`)

  const personUser = new Map<string, string>()
  for (const row of tables["community_people"] ?? [])
    personUser.set(String(row.id), String(row.user_id))
  const listUser = new Map<string, string>()
  for (const row of tables["community_lists"] ?? [])
    listUser.set(String(row.id), String(row.user_id))

  const importer = new InsertAdapter(db, personUser, listUser)

  // Import order respects foreign keys.
  for (const row of tables["users"] ?? [])
    await importer.insert(
      "users -> app_users",
      String(row.id),
      `insert into app_users (id, legacy_clerk_id, extension_installed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5)`,
      [
        row.id,
        row.clerk_user_id ?? null,
        timestamp(row.extension_installed_at),
        timestamp(row.created_at) ?? new Date().toISOString(),
        timestamp(row.updated_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["substack_connections"] ?? [])
    await importer.insert(
      "substack_connections",
      String(row.id),
      `insert into substack_connections
         (id, user_id, generation, status, publication_url, envelope_version,
          key_id, wrapped_key, iv, ciphertext, profile_id, profile_name,
          profile_handle, last_verified_at, created_at, updated_at)
       values ($1, $2, 1, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        row.id, row.user_id, row.publication_url ?? null,
        row.envelope_version, row.key_id, row.wrapped_key, row.iv,
        row.ciphertext, row.profile_id ?? null, row.profile_name ?? null,
        row.profile_handle ?? null, timestamp(row.last_verified_at),
        timestamp(row.created_at) ?? new Date().toISOString(),
        timestamp(row.updated_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_people"] ?? []) {
    const status = (row.relationship_status as string) ?? (row.status as string) ?? null
    const createdAt = timestamp(row.created_at)
    if (!createdAt) {
      await importer.reject("community_people -> people", String(row.id), "invalid created_at")
      continue
    }
    await importer.insert(
      "community_people -> people",
      String(row.id),
      `insert into people
         (id, user_id, name, handle, normalized_handle, profile_url,
          publication_url, relationship_status, notes, source, created_at,
          updated_at, archived_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'd1-import', $10, $11, $12)`,
      [
        row.id, row.user_id, row.name, row.handle ?? null,
        row.normalized_handle ?? null, row.profile_url ?? null,
        row.publication_url ?? null, status, row.notes ?? null,
        createdAt,
        timestamp(row.updated_at) ?? createdAt,
        status === "archived" ? timestamp(row.updated_at) : null,
      ]
    )
    await importer.insert(
      "community_people -> relationship_stats",
      String(row.id),
      `insert into relationship_stats
         (person_id, user_id, interaction_count, conversation_count,
          first_interacted_at, last_interaction_at, drift_status, ai_summary,
          ai_suggested_action, ai_topics, ai_summarized_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
      [
        row.id, row.user_id,
        row.interaction_count ?? 0, row.conversation_count ?? 0,
        timestamp(row.first_interacted_at), timestamp(row.last_engaged_at),
        row.drift_status ?? "new", row.ai_summary ?? null,
        row.ai_suggested_action ?? null, jsonb(row.ai_topics_json),
        timestamp(row.ai_summarized_at),
      ]
    )
  }

  for (const row of tables["community_tags"] ?? [])
    await importer.insert(
      "community_tags -> tags",
      String(row.id),
      `insert into tags (id, user_id, name, normalized_name, color, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id, row.user_id, row.name, row.normalized_name ?? String(row.name).toLowerCase(),
        row.color ?? "#635bff", timestamp(row.created_at) ?? new Date().toISOString(),
        timestamp(row.updated_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_lists"] ?? [])
    await importer.insert(
      "community_lists -> lists",
      String(row.id),
      `insert into lists (id, user_id, name, normalized_name, description, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id, row.user_id, row.name, row.normalized_name ?? String(row.name).toLowerCase(),
        row.description ?? null, timestamp(row.created_at) ?? new Date().toISOString(),
        timestamp(row.updated_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_person_tags"] ?? [])
    await importer.insert(
      "community_person_tags -> person_tags",
      `${row.person_id}/${row.tag_id}`,
      `insert into person_tags (person_id, tag_id, user_id, created_at)
       values ($1, $2, $3, $4)`,
      [
        row.person_id, row.tag_id,
        personUser.get(String(row.person_id)) ?? null,
        timestamp(row.created_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_list_members"] ?? [])
    await importer.insert(
      "community_list_members -> list_members",
      `${row.list_id}/${row.person_id}`,
      `insert into list_members (list_id, person_id, user_id, created_at)
       values ($1, $2, $3, $4)`,
      [
        row.list_id, row.person_id,
        listUser.get(String(row.list_id)) ?? null,
        timestamp(row.created_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_dashboard_views"] ?? [])
    await importer.insert(
      "community_dashboard_views -> saved_views",
      String(row.id),
      `insert into saved_views (id, user_id, tag_id, list_id, created_at)
       values ($1, $2, $3, $4, $5)`,
      [
        row.id ?? randomUUID(), row.user_id, row.tag_id ?? null,
        row.list_id ?? null, timestamp(row.created_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_interactions"] ?? []) {
    const metadata = jsonValue(row.metadata_json)
    const occurredAt = timestamp(row.occurred_at)
    if (!occurredAt) {
      await importer.reject(
        "community_interactions -> interactions",
        String(row.id),
        "invalid occurred_at"
      )
      continue
    }
    const threadKind =
      row.target_type === "note" ? "note" : row.thread_root_id ? "post" : null
    await importer.insert(
      "community_interactions -> interactions",
      String(row.id),
      `insert into interactions
         (id, user_id, person_id, external_id, source, direction, action_type,
          target_type, target_id, target_title, target_url, thread_kind,
          thread_root_id, body, occurred_at, metadata, created_at)
       values ($1, $2, $3, $4, 'import', $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16)`,
      [
        row.id, row.user_id, row.person_id ?? null, row.external_id,
        row.direction, row.action_type, row.target_type ?? null,
        row.target_id ?? null, row.target_title ?? null, row.target_url ?? null,
        threadKind, row.thread_root_id ?? null, row.body ?? null,
        occurredAt,
        JSON.stringify(metadata === undefined ? {} : (metadata ?? {})),
        timestamp(row.created_at) ?? occurredAt,
      ]
    )
    if (metadata === undefined) importer.flag(
      "community_interactions -> interactions",
      String(row.id),
      "metadata_json was not valid JSON; imported with empty metadata"
    )
  }

  for (const row of tables["community_engagements"] ?? [])
    await importer.insert(
      "community_engagements -> legacy_engagements",
      String(row.id),
      `insert into legacy_engagements
         (id, user_id, person_id, target_id, target_type, action_type, metadata, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.id, row.user_id, row.person_id ?? null, row.target_id,
        row.target_type, row.action_type,
        JSON.stringify(jsonValue(row.metadata_json) ?? {}),
        timestamp(row.created_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_content_snapshots"] ?? [])
    await importer.insert(
      "community_content_snapshots -> profile_snapshots",
      String(row.person_id),
      `insert into profile_snapshots
         (person_id, user_id, connection_id, schema_version, payload,
          fetched_at, last_attempted_at, last_error)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.person_id, row.user_id, row.connection_id ?? null,
        row.schema_version, JSON.stringify(jsonValue(row.payload_json) ?? {}),
        timestamp(row.fetched_at),
        timestamp(row.last_attempted_at) ?? new Date().toISOString(),
        row.last_error ?? null,
      ]
    )

  for (const row of tables["activity_snapshots"] ?? [])
    await importer.insert(
      "activity_snapshots",
      String(row.connection_id),
      `insert into activity_snapshots (connection_id, schema_version, payload, captured_at)
       values ($1, $2, $3, $4)`,
      [
        row.connection_id, row.schema_version,
        JSON.stringify(jsonValue(row.payload_json) ?? {}),
        timestamp(row.captured_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["note_replies_snapshots"] ?? [])
    await importer.insert(
      "note_replies_snapshots",
      `${row.connection_id}/${row.note_id}`,
      `insert into note_replies_snapshots (connection_id, note_id, schema_version, payload, captured_at)
       values ($1, $2, $3, $4, $5)`,
      [
        row.connection_id, row.note_id, row.schema_version,
        JSON.stringify(jsonValue(row.payload_json) ?? {}),
        timestamp(row.captured_at) ?? new Date().toISOString(),
      ]
    )

  for (const row of tables["community_activity_backfills"] ?? [])
    await importer.insert(
      "community_activity_backfills -> import_runs",
      String(row.user_id),
      `insert into import_runs
         (id, user_id, connection_id, status, started_at, cutoff, after_cursor,
          oldest_at, finish_reason, pages, items, new_interactions,
          enriched_interactions, new_people, next_request_at, pending, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        randomUUID(), row.user_id, row.connection_id,
        row.status === "running" ? "paused" : String(row.status),
        timestamp(row.started_at) ?? new Date().toISOString(),
        timestamp(row.cutoff) ?? new Date().toISOString(),
        row.after_cursor ?? null, timestamp(row.oldest_at),
        row.finish_reason ?? null, row.pages ?? 0, row.items ?? 0,
        row.new_interactions ?? 0, row.enriched_interactions ?? 0,
        row.new_people ?? 0, epochMillis(row.next_request_at) ?? new Date().toISOString(),
        jsonb(row.pending_json), row.error ?? null,
      ]
    )

  await db.end()

  const reportFile = `${dir}/report.json`
  await writeFile(reportFile, JSON.stringify(importer.report, null, 2))
  if (importer.quarantine.length)
    await writeFile(
      `${dir}/quarantine.json`,
      JSON.stringify(importer.quarantine, null, 2)
    )

  console.log("\nreconciliation")
  for (const [table, entry] of Object.entries(importer.report))
    console.log(
      `${table}: source=${entry.source} imported=${entry.imported} quarantined=${entry.quarantined.length} flagged=${entry.flagged.length}`
    )
  console.log(`\nreport: ${reportFile}`)
  if (importer.quarantine.length)
    console.log(`quarantine: ${dir}/quarantine.json (${importer.quarantine.length})`)
}

// Records per-table import counts and isolates anything that cannot be
// converted or inserted losslessly.
class InsertAdapter {
  report: Record<
    string,
    { source: number; imported: number; quarantined: { id: string; reason: string }[]; flagged: { id: string; reason: string }[] }
  > = {}
  quarantine: { table: string; id: string; reason: string }[] = []
  constructor(
    private readonly db: Pool,
    private readonly personUser: Map<string, string>,
    private readonly listUser: Map<string, string>
  ) {}
  private entry(table: string) {
    return (
      this.report[table] ??
      (this.report[table] = { source: 0, imported: 0, quarantined: [], flagged: [] })
    )
  }
  async insert(table: string, id: string, sql: string, params: unknown[]) {
    const entry = this.entry(table)
    entry.source++
    try {
      await this.db.query(sql, params)
      entry.imported++
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      entry.quarantined.push({ id, reason })
      this.quarantine.push({ table, id, reason })
    }
  }
  async reject(table: string, id: string, reason: string) {
    const entry = this.entry(table)
    entry.source++
    entry.quarantined.push({ id, reason })
    this.quarantine.push({ table, id, reason })
  }
  flag(table: string, id: string, reason: string) {
    this.entry(table).flagged.push({ id, reason })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
