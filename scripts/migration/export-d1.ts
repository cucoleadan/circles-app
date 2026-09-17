import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const DB = process.env.DATABASE || "stackedhq-app-db"
const OUT = process.env.OUT || join(import.meta.dir, "exports")

const TABLES = [
  "users",
  "substack_connections",
  "community_people",
  "community_tags",
  "community_person_tags",
  "community_lists",
  "community_list_members",
  "community_dashboard_views",
  "community_interactions",
  "community_engagements",
  "community_content_snapshots",
  "activity_snapshots",
  "note_replies_snapshots",
  "community_activity_backfills",
]

await mkdir(OUT, { recursive: true })
console.log(`Exporting D1 database "${DB}" to ${OUT}...`)

for (const table of TABLES) {
  process.stdout.write(`Exporting ${table}... `)
  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--json",
      "--command",
      `SELECT * FROM ${table}`,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  )

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.error(`FAILED: ${stderr || stdout}`)
    continue
  }

  // Find start of JSON array
  const jsonStart = stdout.indexOf("[")
  if (jsonStart === -1) {
    console.error(`Invalid JSON output: ${stdout}`)
    continue
  }

  const jsonText = stdout.slice(jsonStart)
  const filePath = join(OUT, `${table}.json`)
  await writeFile(filePath, jsonText, "utf8")
  try {
    const parsed = JSON.parse(jsonText)
    const count = parsed[0]?.results?.length ?? 0
    console.log(`OK (${count} rows)`)
  } catch {
    console.log("OK (raw)")
  }
}

console.log("\nExport complete!")
