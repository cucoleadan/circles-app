import type { ConnectionEnvelope } from "../connections/connection.types";
import {
  getGatewayCommunityContent,
  parseGatewayCommunityContentResult,
} from "../../services/gateway/community-content.server";
import type { GatewayRequestPacer } from "../../services/gateway/request-pacer.server";
import type {
  CommunityContent,
  CommunityContentSnapshot,
} from "./types";

const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 1_000_000;
const TARGET_PAGE_SIZE = 25;
const GENERIC_SYNC_ERROR = "The latest background refresh was unsuccessful.";

type SnapshotRow = {
  person_id: string;
  payload_json: string | null;
  fetched_at: string | null;
  last_attempted_at: string;
  last_error: string | null;
};

type SyncTargetRow = {
  person_id: string;
  user_id: string;
  connection_id: string;
  publication_url: string;
  handle: string;
  target_publication_url: string | null;
  envelope_version: number;
  key_id: string;
  wrapped_key: string;
  iv: string;
  ciphertext: string;
};

export type CommunityContentSyncTarget = {
  personId: string;
  userId: string;
  connectionId: string;
  publicationUrl: string;
  handle: string;
  targetPublicationUrl: string | null;
  envelope: ConnectionEnvelope;
};

function snapshotStatus(
  content: CommunityContent | null,
  lastError: string | null,
): CommunityContentSnapshot["status"] {
  if (content && lastError) return "stale";
  if (content) return "ready";
  if (lastError) return "error";
  return "pending";
}

export function parseCommunityContentSnapshotRow(
  row: SnapshotRow,
): CommunityContentSnapshot {
  let content: CommunityContent | null = null;
  let malformed = false;

  if (row.payload_json !== null) {
    try {
      content = parseGatewayCommunityContentResult(JSON.parse(row.payload_json));
    } catch {
      malformed = true;
    }
  }

  const lastError = malformed ? GENERIC_SYNC_ERROR : row.last_error;
  return {
    personId: row.person_id,
    content,
    syncedAt: content ? row.fetched_at : null,
    lastAttemptedAt: row.last_attempted_at,
    status: snapshotStatus(content, lastError),
  };
}

export async function getCommunityContentSnapshot(
  db: D1Database,
  userId: string,
  personId: string,
): Promise<CommunityContentSnapshot | null> {
  const row = await db
    .prepare(
      "SELECT person_id, payload_json, fetched_at, last_attempted_at, last_error " +
        "FROM community_content_snapshots WHERE user_id = ? AND person_id = ? LIMIT 1",
    )
    .bind(userId, personId)
    .first<SnapshotRow>();

  return row ? parseCommunityContentSnapshotRow(row) : null;
}

export async function listCommunityContentSnapshots(
  db: D1Database,
  userId: string,
): Promise<CommunityContentSnapshot[]> {
  const result = await db
    .prepare(
      "SELECT person_id, payload_json, fetched_at, last_attempted_at, last_error " +
        "FROM community_content_snapshots WHERE user_id = ? ORDER BY person_id",
    )
    .bind(userId)
    .all<SnapshotRow>();

  return result.results.map(parseCommunityContentSnapshotRow);
}

export async function storeCommunityContentSnapshot({
  db,
  userId,
  connectionId,
  personId,
  content,
  attemptedAt = new Date().toISOString(),
}: {
  db: D1Database;
  userId: string;
  connectionId: string;
  personId: string;
  content: CommunityContent;
  attemptedAt?: string;
}) {
  const validated = parseGatewayCommunityContentResult(content);
  const payload = JSON.stringify(validated);
  if (new TextEncoder().encode(payload).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("The Community content snapshot is too large.");
  }

  await db
    .prepare(
      "INSERT INTO community_content_snapshots (" +
        "person_id, user_id, connection_id, schema_version, payload_json, fetched_at, " +
        "last_attempted_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) " +
        "ON CONFLICT(person_id) DO UPDATE SET user_id = excluded.user_id, " +
        "connection_id = excluded.connection_id, schema_version = excluded.schema_version, " +
        "payload_json = excluded.payload_json, fetched_at = excluded.fetched_at, " +
        "last_attempted_at = excluded.last_attempted_at, last_error = NULL",
    )
    .bind(
      personId,
      userId,
      connectionId,
      SNAPSHOT_SCHEMA_VERSION,
      payload,
      attemptedAt,
      attemptedAt,
    )
    .run();
}

export async function recordCommunityContentSyncFailure({
  db,
  userId,
  connectionId,
  personId,
  attemptedAt = new Date().toISOString(),
}: {
  db: D1Database;
  userId: string;
  connectionId: string;
  personId: string;
  attemptedAt?: string;
}) {
  await db
    .prepare(
      "INSERT INTO community_content_snapshots (" +
        "person_id, user_id, connection_id, schema_version, payload_json, fetched_at, " +
        "last_attempted_at, last_error) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?) " +
        "ON CONFLICT(person_id) DO UPDATE SET user_id = excluded.user_id, " +
        "connection_id = excluded.connection_id, last_attempted_at = excluded.last_attempted_at, " +
        "last_error = excluded.last_error",
    )
    .bind(
      personId,
      userId,
      connectionId,
      SNAPSHOT_SCHEMA_VERSION,
      attemptedAt,
      GENERIC_SYNC_ERROR,
    )
    .run();
}

export async function listCommunityContentSyncTargets(
  db: D1Database,
  {
    afterPersonId,
    missingOnly,
    limit = TARGET_PAGE_SIZE,
  }: {
    afterPersonId: string | null;
    missingOnly: boolean;
    limit?: number;
  },
): Promise<CommunityContentSyncTarget[]> {
  const missingClause = missingOnly
    ? "AND (snapshot.person_id IS NULL OR snapshot.payload_json IS NULL OR snapshot.connection_id <> connection.id) "
    : "";
  const result = await db
    .prepare(
      "SELECT person.id AS person_id, person.user_id, person.handle, " +
        "person.publication_url AS target_publication_url, connection.id AS connection_id, " +
        "connection.publication_url, connection.envelope_version, connection.key_id, " +
        "connection.wrapped_key, connection.iv, connection.ciphertext " +
        "FROM community_people person " +
        "JOIN substack_connections connection ON connection.user_id = person.user_id " +
        "LEFT JOIN community_content_snapshots snapshot ON snapshot.person_id = person.id " +
        "WHERE connection.publication_url IS NOT NULL AND connection.publication_url <> '' " +
        "AND connection.envelope_version = 1 AND (? IS NULL OR person.id > ?) " +
        missingClause +
        "ORDER BY person.id LIMIT ?",
    )
    .bind(afterPersonId, afterPersonId, limit)
    .all<SyncTargetRow>();

  return result.results.map((row) => ({
    personId: row.person_id,
    userId: row.user_id,
    connectionId: row.connection_id,
    publicationUrl: row.publication_url,
    handle: row.handle,
    targetPublicationUrl: row.target_publication_url,
    envelope: {
      version: 1,
      keyId: row.key_id,
      wrappedKey: row.wrapped_key,
      iv: row.iv,
      ciphertext: row.ciphertext,
    },
  }));
}

export async function syncCommunityContentSnapshot(
  env: Pick<Env, "stackedhq_app_db">,
  target: CommunityContentSyncTarget,
  beforeGatewayRequest: GatewayRequestPacer,
) {
  const attemptedAt = new Date().toISOString();
  try {
    const content = await getGatewayCommunityContent(
      {
        envelope: target.envelope,
        publicationUrl: target.publicationUrl,
        handle: target.handle,
        targetPublicationUrl: target.targetPublicationUrl,
      },
      { beforeGatewayRequest },
    );
    await storeCommunityContentSnapshot({
      db: env.stackedhq_app_db,
      userId: target.userId,
      connectionId: target.connectionId,
      personId: target.personId,
      content,
      attemptedAt,
    });
    return true;
  } catch {
    await recordCommunityContentSyncFailure({
      db: env.stackedhq_app_db,
      userId: target.userId,
      connectionId: target.connectionId,
      personId: target.personId,
      attemptedAt,
    });
    return false;
  }
}

export async function syncCommunityContentSnapshots(
  env: Env,
  {
    missingOnly,
    beforeGatewayRequest,
  }: {
    missingOnly: boolean;
    beforeGatewayRequest: GatewayRequestPacer;
  },
) {
  let afterPersonId: string | null = null;
  let synchronized = 0;
  let failed = 0;

  while (true) {
    const targets = await listCommunityContentSyncTargets(env.stackedhq_app_db, {
      afterPersonId,
      missingOnly,
    });
    if (targets.length === 0) break;

    for (const target of targets) {
      if (
        await syncCommunityContentSnapshot(
          env,
          target,
          beforeGatewayRequest,
        )
      ) {
        synchronized += 1;
      } else {
        failed += 1;
      }
    }

    afterPersonId = targets.at(-1)!.personId;
    if (targets.length < TARGET_PAGE_SIZE) break;
  }

  return { synchronized, failed };
}
