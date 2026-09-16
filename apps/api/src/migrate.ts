import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { db } from "./db.js"

const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url))

async function connect() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await db.query("select 1")
      return
    } catch (error) {
      if (attempt === 30) throw error
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

await connect()
await db.query(`create table if not exists app_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`)

const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort()
for (const file of files) {
  const applied = await db.query("select 1 from app_migrations where name = $1", [file])
  if (applied.rowCount) continue

  const client = await db.connect()
  try {
    await client.query("begin")
    await client.query(await readFile(`${migrationsDirectory}/${file}`, "utf8"))
    await client.query("insert into app_migrations (name) values ($1)", [file])
    await client.query("commit")
    console.log(`Applied ${file}`)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

await db.end()
