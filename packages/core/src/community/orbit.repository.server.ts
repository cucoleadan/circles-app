import type { OrbitHistory } from "./orbit-data";

type PreviewRow = { id: string; person_id: string; direction: "inbound" | "outbound"; action_type: string; body: string | null; target_title: string | null; occurred_at: string; metadata_json: string | null; total: number; inbound: number; outbound: number; comments: number; saved_at: string };

/** Three previews per person; aggregate counts cover their entire saved history. */
export async function getOrbitHistory(db: D1Database, userId: string): Promise<Record<string, OrbitHistory>> {
  const rows = await db.prepare(
    "WITH ranked AS (SELECT id, person_id, direction, action_type, substr(body, 1, 600) AS body, target_title, occurred_at, metadata_json, " +
    "ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY occurred_at DESC, id DESC) AS position, " +
    "COUNT(*) OVER (PARTITION BY person_id) AS total, " +
    "SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) OVER (PARTITION BY person_id) AS inbound, " +
    "SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) OVER (PARTITION BY person_id) AS outbound, " +
    "SUM(CASE WHEN action_type IN ('comment', 'reply') THEN 1 ELSE 0 END) OVER (PARTITION BY person_id) AS comments, " +
    "MAX(created_at) OVER (PARTITION BY person_id) AS saved_at " +
    "FROM community_interactions WHERE user_id = ? AND person_id IS NOT NULL) " +
    "SELECT * FROM ranked WHERE position <= 3 ORDER BY person_id, position",
  ).bind(userId).all<PreviewRow>();
  const history: Record<string, OrbitHistory> = {};
  for (const row of rows.results) {
    let avatarUrl: string | null = null;
    if (row.direction === "inbound") {
      try {
        const metadata = JSON.parse(row.metadata_json ?? "{}");
        const value = metadata?.authorPhotoUrl ?? metadata?.actorAvatarUrl;
        if (typeof value === "string" && new URL(value).protocol === "https:") avatarUrl = value;
      } catch { /* Legacy metadata must not prevent the overview from loading. */ }
    }
    const saved = history[row.person_id] ??= { total: row.total, inbound: row.inbound, outbound: row.outbound, comments: row.comments, latestAt: row.occurred_at, savedAt: row.saved_at, preview: [] };
    saved.preview.push({ id: row.id, direction: row.direction, actionType: row.action_type, body: row.body, title: row.target_title, occurredAt: row.occurred_at, avatarUrl });
  }
  return history;
}
