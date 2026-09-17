import type { Pool } from "pg"

const escapeSqlLiteral = (value: string) => value.replace(/'/g, "''")
const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`

async function ensureLoginRole(db: Pool, role: string, password: string) {
  const exists = await db.query("select 1 from pg_roles where rolname = $1", [
    role,
  ])
  const statement = exists.rowCount
    ? `alter role ${role} login password '${escapeSqlLiteral(password)}'`
    : `create role ${role} login password '${escapeSqlLiteral(
        password
      )}' nosuperuser nocreatedb nocreaterole`
  await db.query(statement)
}

export async function bootstrapRoles(
  db: Pool,
  passwords: { app: string; migrate: string }
) {
  await ensureLoginRole(db, "circles_migrate", passwords.migrate)
  await ensureLoginRole(db, "circles_app", passwords.app)

  await db.query("grant usage on schema public to circles_app, circles_migrate")
  await db.query("grant create on schema public to circles_migrate")

  const tables = await db.query<{ name: string }>(
    `select tablename as name from pg_tables
      where schemaname = 'public' and tableowner <> 'circles_migrate'`
  )
  for (const row of tables.rows) {
    await db.query(
      `alter table public.${quoteIdent(row.name)} owner to circles_migrate`
    )
  }

  const sequences = await db.query<{ name: string }>(
    `select sequencename as name from pg_sequences
      where schemaname = 'public' and sequenceowner <> 'circles_migrate'`
  )
  for (const row of sequences.rows) {
    await db.query(
      `alter sequence public.${quoteIdent(row.name)} owner to circles_migrate`
    )
  }

  await db.query(
    "grant select, insert, update, delete on all tables in schema public to circles_app"
  )
  await db.query(
    "grant usage, select on all sequences in schema public to circles_app"
  )
  await db.query(
    `alter default privileges for role circles_migrate in schema public
       grant select, insert, update, delete on tables to circles_app`
  )
  await db.query(
    `alter default privileges for role circles_migrate in schema public
       grant usage, select on sequences to circles_app`
  )
}
