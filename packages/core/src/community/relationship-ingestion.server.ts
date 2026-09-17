import type { GatewayActivityItem } from "../../services/gateway/activity.server";
import { classifyActivityKind } from "../dashboard/activity";
import type { CommunityNoteReplies, CommunityNoteReply, DriftStatus } from "./types";
import { enrichCommunityInteraction } from "./interaction-enrichment.server";

export type IngestionStats = {
  processedItems: number;
  newInteractions: number;
  enrichedInteractions: number;
  newPeople: number;
  updatedPeople: number;
};

export async function recalculateCommunityRelationship(
  db: D1Database,
  userId: string,
  personId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const statsRow = await db
    .prepare(
      "SELECT COUNT(*) as total_interactions, " +
        "COUNT(DISTINCT thread_root_id) as total_conversations, " +
        "MIN(occurred_at) as first_at, " +
        "MAX(occurred_at) as last_at " +
      "FROM community_interactions WHERE user_id = ? AND person_id = ?",
    )
    .bind(userId, personId)
    .first<{
      total_interactions: number;
      total_conversations: number;
      first_at: string | null;
      last_at: string | null;
    }>();

  if (!statsRow) return false;

  const total = statsRow.total_interactions ?? 0;
  const conversations = statsRow.total_conversations ?? 0;
  const firstAt = statsRow.first_at;
  const lastAt = statsRow.last_at;
  const drift = calculateDriftStatus(lastAt, firstAt, total);

  await db
    .prepare(
      "UPDATE community_people SET " +
        "interaction_count = ?, " +
        "conversation_count = ?, " +
        "first_interacted_at = COALESCE(?, first_interacted_at), " +
        "last_engaged_at = COALESCE(?, last_engaged_at), " +
        "drift_status = ?, " +
        "updated_at = ? " +
      "WHERE id = ? AND user_id = ?",
    )
    .bind(total, conversations, firstAt, lastAt, drift, now, personId, userId)
    .run();

  return true;
}

export function calculateDriftStatus(
  lastInteractedAt: string | null,
  firstInteractedAt: string | null,
  totalInteractions: number,
  nowMs = Date.now(),
): DriftStatus {
  if (!lastInteractedAt) return "new";
  const lastMs = Date.parse(lastInteractedAt);
  if (Number.isNaN(lastMs)) return "new";

  const diffDays = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
  if (diffDays <= 7 && totalInteractions <= 2) {
    return "new";
  }
  if (diffDays < 14) {
    return "active";
  }
  if (diffDays <= 45) {
    return "drifting";
  }
  return "cold";
}

export type ReplyIngestionStats = {
  processedReplies: number;
  newInteractions: number;
  enrichedInteractions: number;
  newPeople: number;
  updatedPeople: number;
};

export async function ingestNoteRepliesIntoRelationships({
  db,
  userId,
  replies,
  ownerId,
  ownerHandle,
  targetType = "note",
  sourceUrl,
  rootAuthor,
}: {
  db: D1Database;
  userId: string;
  replies: CommunityNoteReplies;
  ownerId?: string | number | null;
  ownerHandle?: string | null;
  targetType?: "note" | "post";
  sourceUrl?: string;
  rootAuthor?: CommunityNoteReply | null;
}): Promise<ReplyIngestionStats> {
  const normalizedOwnerId = ownerId === null || ownerId === undefined
    ? null
    : String(ownerId);
  const normalizedOwnerHandle = ownerHandle?.trim().toLocaleLowerCase("en") ?? null;
  const now = new Date().toISOString();
  const existingPeople = await db
    .prepare("SELECT id, normalized_handle FROM community_people WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; normalized_handle: string }>();
  const personIdByHandle = new Map(
    existingPeople.results.map((person) => [person.normalized_handle, person.id]),
  );
  const touchedPersonIds = new Set<string>();
  let processedReplies = 0;
  let newInteractions = 0;
  let enrichedInteractions = 0;
  let newPeople = 0;

  const ensurePerson = async (reply: CommunityNoteReply): Promise<string | null> => {
    const rawHandle = reply.authorHandle?.trim();
    if (!rawHandle) return null;
    const normalizedHandle = rawHandle.toLocaleLowerCase("en");
    const knownPersonId = personIdByHandle.get(normalizedHandle);
    if (knownPersonId) return knownPersonId;

    const personId = crypto.randomUUID();
    const occurredAt = reply.createdAt ?? now;
    const inserted = await db
      .prepare(
        "INSERT OR IGNORE INTO community_people (" +
          "id, user_id, name, handle, normalized_handle, profile_url, status, " +
          "relationship_status, drift_status, first_interacted_at, last_engaged_at, " +
          "interaction_count, created_at, updated_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, 'new', 'new', 'new', ?, ?, 0, ?, ?)",
      )
      .bind(
        personId,
        userId,
        reply.authorName?.trim() || rawHandle,
        rawHandle,
        normalizedHandle,
        `https://substack.com/@${encodeURIComponent(rawHandle)}`,
        occurredAt,
        occurredAt,
        now,
        now,
      )
      .run();

    if (inserted.meta.changes > 0) {
      personIdByHandle.set(normalizedHandle, personId);
      newPeople++;
      return personId;
    }

    const existing = await db
      .prepare(
        "SELECT id FROM community_people WHERE user_id = ? AND normalized_handle = ? LIMIT 1",
      )
      .bind(userId, normalizedHandle)
      .first<{ id: string }>();
    if (!existing) return null;
    personIdByHandle.set(normalizedHandle, existing.id);
    return existing.id;
  };

  const visit = async (
    reply: CommunityNoteReply,
    parentCommentId: string | null,
    conversationPersonId: string | null,
  ): Promise<void> => {
    processedReplies++;
    const normalizedHandle = reply.authorHandle?.trim().toLocaleLowerCase("en") ?? null;
    const isOwner =
      (normalizedOwnerId !== null && reply.authorId === normalizedOwnerId) ||
      (normalizedOwnerHandle !== null && normalizedHandle === normalizedOwnerHandle);
    const actorPersonId = isOwner ? null : await ensurePerson(reply);
    const personId = actorPersonId ?? conversationPersonId;

    if (personId) {
      const metadataJson = JSON.stringify({
        authorName: reply.authorName,
        authorHandle: reply.authorHandle,
        authorPhotoUrl: reply.authorPhotoUrl,
      });
      const result = await db
        .prepare(
          "INSERT INTO community_interactions (" +
            "id, user_id, person_id, external_id, direction, action_type, target_type, " +
            "target_id, thread_root_id, body, occurred_at, metadata_json, created_at, target_url" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(user_id, external_id) DO NOTHING",
        )
        .bind(
          crypto.randomUUID(),
          userId,
          personId,
          `comment:${reply.id}`,
          isOwner ? "outbound" : "inbound",
          parentCommentId ? "reply" : "comment",
          parentCommentId ? "comment" : targetType,
          parentCommentId ?? replies.noteId,
          targetType === "post" ? `post:${replies.noteId}` : replies.noteId,
          reply.body,
          reply.createdAt ?? now,
          metadataJson,
          now,
          sourceUrl ?? null,
        )
        .run();
      if (result.meta.changes > 0) newInteractions++;
      else if (await enrichCommunityInteraction(db, userId, `comment:${reply.id}`, {
        body: reply.body, threadRootId: targetType === "post" ? `post:${replies.noteId}` : replies.noteId,
        targetId: parentCommentId ?? replies.noteId, targetType: parentCommentId ? "comment" : targetType,
        actionType: parentCommentId ? "reply" : "comment", occurredAt: reply.createdAt,
        targetUrl: sourceUrl, metadata: JSON.parse(metadataJson), source: "conversation",
      })) enrichedInteractions++;
      touchedPersonIds.add(personId);
    }

    const nextConversationPersonId = actorPersonId ?? conversationPersonId;
    for (const child of reply.children) {
      await visit(child, reply.id, nextConversationPersonId);
    }
  };

  const rootIsOwner = rootAuthor && (
    (normalizedOwnerId !== null && rootAuthor.authorId === normalizedOwnerId) ||
    (normalizedOwnerHandle !== null && rootAuthor.authorHandle?.trim().toLocaleLowerCase("en") === normalizedOwnerHandle)
  );
  const rootPersonId = rootAuthor && !rootIsOwner ? await ensurePerson(rootAuthor) : null;
  for (const reply of replies.comments) {
    await visit(reply, null, rootPersonId);
  }

  let updatedPeople = 0;
  for (const personId of touchedPersonIds) {
    if (await recalculateCommunityRelationship(db, userId, personId, now)) {
      updatedPeople++;
    }
  }

  return { processedReplies, newInteractions, enrichedInteractions, newPeople, updatedPeople };
}

/**
 * Ingests raw GatewayActivityItem records into the permanent relationship CRM:
 * 1. Upserts actors into `community_people`
 * 2. Appends interactions idempotently into `community_interactions`
 * 3. Updates relationship counts, touchpoints, and drift scoring
 */
export async function ingestActivityIntoRelationships({
  db,
  userId,
  items,
  ownerHandle,
  strict = false,
}: {
  db: D1Database;
  userId: string;
  items: GatewayActivityItem[];
  ownerHandle?: string | null;
  strict?: boolean;
}): Promise<IngestionStats> {
  const normalizedOwnerHandle = ownerHandle?.toLowerCase().trim() ?? null;
  const now = new Date().toISOString();

  let newPeople = 0;
  let newInteractions = 0;
  let enrichedInteractions = 0;
  const touchedPersonIds = new Set<string>();

  console.log(
    `[StackedHQ CRM Ingestion] Starting ingestion of ${items.length} activity items for user ${userId}...`,
  );

  // Cache existing people by normalized handle for rapid lookup
  const existingPeopleRows = await db
    .prepare("SELECT id, normalized_handle FROM community_people WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; normalized_handle: string }>();

  const personIdByHandle = new Map<string, string>();
  for (const row of existingPeopleRows.results) {
    personIdByHandle.set(row.normalized_handle, row.id);
  }

  for (const item of items) {
    const rawHandle = item.actorHandle;
    if (!rawHandle) continue;

    const normalizedHandle = rawHandle.toLowerCase().trim();
    // Skip self-actions
    if (normalizedOwnerHandle && normalizedHandle === normalizedOwnerHandle) {
      continue;
    }

    let personId = personIdByHandle.get(normalizedHandle);

    if (!personId) {
      // Create new person record
      personId = crypto.randomUUID();
      const name = item.actorName?.trim() || rawHandle;
      const profileUrl = `https://substack.com/@${encodeURIComponent(rawHandle)}`;
      const occurredAt = item.createdAt ?? now;

      try {
        await db
          .prepare(
            "INSERT INTO community_people (" +
              "id, user_id, name, handle, normalized_handle, profile_url, " +
              "status, relationship_status, drift_status, first_interacted_at, " +
              "last_engaged_at, interaction_count, created_at, updated_at" +
            ") VALUES (?, ?, ?, ?, ?, ?, 'new', 'new', 'new', ?, ?, 0, ?, ?)",
          )
          .bind(
            personId,
            userId,
            name,
            rawHandle,
            normalizedHandle,
            profileUrl,
            occurredAt,
            occurredAt,
            now,
            now,
          )
          .run();

        personIdByHandle.set(normalizedHandle, personId);
        newPeople++;
        console.log(`[StackedHQ CRM Ingestion] ✨ Discovered new person: @${rawHandle} (${name})`);
      } catch (cause) {
        // If conflict occurs concurrently, lookup again
        const existing = await db
          .prepare("SELECT id FROM community_people WHERE user_id = ? AND normalized_handle = ? LIMIT 1")
          .bind(userId, normalizedHandle)
          .first<{ id: string }>();
        if (existing) {
          personId = existing.id;
          personIdByHandle.set(normalizedHandle, personId);
        } else {
          if (strict) throw cause;
          continue;
        }
      }
    }

    touchedPersonIds.add(personId);

    // Prepare interaction record
    const senderScoped = /:sender:\d+$/.test(item.id);
    const externalId = item.commentId && !senderScoped
      ? `comment:${item.commentId}`
      : item.id || `act_${item.kind}_${personId}_${item.createdAt ?? now}`;
    const classifiedAction = classifyActivityKind(
      item.kind,
      Boolean(item.commentBody || item.commentId),
    );
    const actionType = classifiedAction === "follow" ? "subscribe" : classifiedAction;
    const targetType = item.targetKind ?? (item.targetTitle ? "post" : "note");
    const occurredAt = item.createdAt ?? now;
    const metadata = JSON.stringify({
      actorName: item.actorName,
      actorHandle: item.actorHandle,
      actorAvatarUrl: item.actorAvatarUrl,
      targetTitle: item.targetTitle,
      targetBody: item.targetBody,
      targetAuthorName: item.targetAuthorName,
      targetAuthorHandle: item.targetAuthorHandle,
      targetReactionCount: item.targetReactionCount,
      targetReplyCount: item.targetReplyCount,
      targetRestackCount: item.targetRestackCount,
      senderCount: item.senderCount,
    });

    try {
      // Upgrade the old first-sender row in place, preserving its identity and
      // count. Other people in the same group get independent records.
      if (senderScoped) await db.prepare("UPDATE community_interactions SET external_id = ? WHERE user_id = ? AND external_id = ? AND person_id = ? AND NOT EXISTS (SELECT 1 FROM community_interactions WHERE user_id = ? AND external_id = ?)")
        .bind(externalId, userId, item.id.replace(/:sender:\d+$/, ""), personId, userId, externalId).run();
      const interactionResult = await db
        .prepare(
          "INSERT INTO community_interactions (" +
            "id, user_id, person_id, external_id, direction, action_type, " +
            "target_type, target_id, target_title, target_url, thread_root_id, " +
            "body, occurred_at, metadata_json, created_at" +
          ") VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(user_id, external_id) DO NOTHING",
        )
        .bind(
          crypto.randomUUID(),
          userId,
          personId,
          externalId,
          actionType,
          targetType,
          item.commentId ?? item.targetUrl ?? item.id,
          item.targetTitle ?? null,
          item.targetUrl ?? null,
          item.rootCommentId ?? null,
          item.commentBody ?? null,
          occurredAt,
          metadata,
          now,
        )
        .run();

      if (interactionResult.meta.changes > 0) {
        newInteractions++;
      } else if (await enrichCommunityInteraction(db, userId, externalId, {
        body: item.commentBody, targetTitle: item.targetTitle, targetUrl: item.targetUrl,
        threadRootId: item.rootCommentId, targetId: item.commentId ?? item.targetUrl ?? item.id,
        targetType, actionType, occurredAt: item.createdAt, metadata: JSON.parse(metadata), source: "activity",
      })) {
        enrichedInteractions++;
      }
    } catch (cause) {
      console.warn(
        `[StackedHQ CRM Ingestion] Warning: Could not insert interaction ${externalId}:`,
        cause instanceof Error ? cause.message : cause,
      );
      if (strict) throw cause;
    }
  }

  // Recalculate metrics & drift status for all touched people
  let updatedPeople = 0;

  for (const personId of touchedPersonIds) {
    if (await recalculateCommunityRelationship(db, userId, personId, now)) {
      updatedPeople++;
    }
  }

  const result: IngestionStats = {
    processedItems: items.length,
    newInteractions,
    enrichedInteractions,
    newPeople,
    updatedPeople,
  };

  console.log(
    `[StackedHQ CRM Ingestion] ✅ Completed: ${newInteractions} new interactions, ${enrichedInteractions} enriched, ` +
      `${newPeople} new people, ${updatedPeople} relationship profiles updated.`,
  );

  return result;
}
