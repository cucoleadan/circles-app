type Enrichment = {
  body: string | null; targetTitle?: string | null; targetUrl?: string | null;
  threadRootId: string | null; targetId: string | null; targetType: string;
  actionType: string; occurredAt: string | null; metadata: Record<string, unknown>;
  source: "activity" | "conversation";
};

/** Atomic monotonic merge: repeated or less detailed captures cannot erase richer data. */
export async function enrichCommunityInteraction(db: D1Database, userId: string, externalId: string, incoming: Enrichment): Promise<boolean> {
  const metadata = Object.fromEntries(Object.entries(incoming.metadata).filter(([, value]) => value !== null && value !== undefined && value !== ""));
  const oldMetadata = "CASE WHEN json_valid(existing.metadata_json) THEN existing.metadata_json ELSE '{}' END";
  const conversation = "incoming.source = 'conversation'";
  const context = `${conversation} AND (existing.action_type != 'reply' OR incoming.action_type = 'reply')`;
  const expressions: Record<string, string> = {
    body: "CASE WHEN length(incoming.body) > COALESCE(length(existing.body), 0) THEN incoming.body ELSE existing.body END",
    target_title: "COALESCE(NULLIF(existing.target_title, ''), incoming.target_title)",
    target_url: "CASE WHEN instr(existing.target_url, '/api/v1/') > 0 AND incoming.target_url IS NOT NULL AND instr(incoming.target_url, '/api/v1/') = 0 THEN incoming.target_url ELSE COALESCE(NULLIF(existing.target_url, ''), incoming.target_url) END",
    thread_root_id: `CASE WHEN ${conversation} THEN COALESCE(incoming.thread_root_id, existing.thread_root_id) ELSE COALESCE(existing.thread_root_id, incoming.thread_root_id) END`,
    target_id: `CASE WHEN ${context} THEN COALESCE(incoming.target_id, existing.target_id) ELSE COALESCE(existing.target_id, incoming.target_id) END`,
    target_type: `CASE WHEN ${context} THEN incoming.target_type ELSE COALESCE(existing.target_type, incoming.target_type) END`,
    action_type: `CASE WHEN ${conversation} AND incoming.action_type = 'reply' THEN 'reply' ELSE existing.action_type END`,
    occurred_at: "CASE WHEN julianday(incoming.occurred_at) < julianday(existing.occurred_at) THEN incoming.occurred_at ELSE existing.occurred_at END",
    metadata_json: `CASE WHEN ${conversation} THEN json_patch(${oldMetadata}, incoming.metadata_json) ELSE json_patch(incoming.metadata_json, ${oldMetadata}) END`,
  };
  // SQL identifiers and expressions are fixed application code; all capture values are bound.
  const sql = "WITH incoming AS (SELECT ? AS body, ? AS target_title, ? AS target_url, ? AS thread_root_id, ? AS target_id, ? AS target_type, ? AS action_type, ? AS occurred_at, ? AS metadata_json, ? AS source) " +
    "UPDATE community_interactions AS existing SET " + Object.entries(expressions).map(([field, expression]) => `${field} = ${expression}`).join(", ") +
    " FROM incoming WHERE existing.user_id = ? AND existing.external_id = ? AND (" + Object.entries(expressions).map(([field, expression]) => `existing.${field} IS NOT (${expression})`).join(" OR ") + ")";
  const result = await db.prepare(sql).bind(incoming.body, incoming.targetTitle ?? null, incoming.targetUrl ?? null, incoming.threadRootId, incoming.targetId, incoming.targetType, incoming.actionType, incoming.occurredAt, JSON.stringify(metadata), incoming.source, userId, externalId).run();
  return result.meta.changes > 0;
}
