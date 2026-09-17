import type { ConnectionEnvelope } from "../../features/connections/connection.types";
import {
  noteDocumentText,
  parseNoteDocument,
  safeNoteUrl,
} from "../../features/notes/note-content";
import { gatewayInternalFetch } from "./client.server";
import { backfillTimestamp } from "../../features/community/activity-backfill";
import type { BackfillPage } from "../../features/community/activity-backfill";

export type GatewayActivityTargetKind = "post" | "note" | "comment";

/** Allow-listed, normalized activity-feed item. */
export type GatewayActivityItem = {
  id: string;
  kind: string;
  createdAt: string | null;
  senderCount: number | null;
  isNew: boolean;
  actorName: string | null;
  actorHandle: string | null;
  actorAvatarUrl: string | null;
  commentId: string | null;
  commentBody: string | null;
  commentAuthorId: string | null;
  ancestorPath: string[];
  rootCommentId: string | null;
  targetKind: GatewayActivityTargetKind | null;
  targetTitle: string | null;
  targetBody: string | null;
  targetAuthorName: string | null;
  targetAuthorHandle: string | null;
  targetUrl: string | null;
  targetReactionCount: number | null;
  targetRestackCount: number | null;
  targetReplyCount: number | null;
  targetViewerLiked: boolean | null;
};

const MAX_ACTIVITY_ITEMS = 500;

export function parseActivityBackfillPage(value: unknown, after: string | null, cutoff: string): BackfillPage {
  if (!isRecord(value) || !Array.isArray(value.activityItems) || value.activityItems.length > MAX_ACTIVITY_ITEMS || typeof value.more !== "boolean") throw new Error("Invalid paginated activity response.");
  const boundary = backfillTimestamp(cutoff);
  const cursor = after === null ? Infinity : backfillTimestamp(after);
  if (!value.activityItems.length && value.more) throw new Error("Empty activity page reports more history.");
  let last = Infinity;
  let oldest = Infinity;
  let newest = -Infinity;
  const selected: Record<string, unknown>[] = [];
  for (const item of value.activityItems) {
    if (!isRecord(item)) throw new Error("Invalid historical activity item.");
    const time = backfillTimestamp(item.updated_at);
    // Native ranking is not chronological; grouped items can also update after
    // the requested cursor. Only the final item determines pagination.
    last = time;
    oldest = Math.min(oldest, time);
    newest = Math.max(newest, time);
    // Grouped notifications may have old creation dates but recent activity.
    if (time >= boundary) selected.push({ ...item, created_at: item.updated_at });
  }
  if (value.activityItems.length && last - 1 >= cursor) throw new Error("Historical activity cursor did not advance.");
  if (value.more) {
    const next = backfillTimestamp(value.nextAfter);
    if (next >= cursor || next !== last - 1) throw new Error("Historical activity cursor did not advance or does not match the final item.");
  } else if (value.nextAfter !== null) throw new Error("Terminal activity page has an unexpected cursor.");
  // Do not stop on a single old item in a mixed, non-chronological page.
  const reason = value.activityItems.length && newest <= boundary ? "cutoff" : !value.more ? "exhausted" : "continue";
  const selectedPage = { ...value, activityItems: selected };
  if (parseGatewayActivityResult(selectedPage).length !== selected.length) throw new Error("Some historical activity items could not be parsed; import paused to avoid skipping them.");
  const items = parseGatewayRelationshipActivityResult(selectedPage);
  return { items, notificationCount: selected.length, nextAfter: reason === "continue" ? value.nextAfter as string : null,
    oldestAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null, reason };
}

export class ActivityBackfillReadError extends Error {
  constructor(public readonly retryAt: number, message: string) { super(message); }
}
export async function getGatewayActivityPage(input: { envelope: ConnectionEnvelope; publicationUrl: string; after: string | null; cutoff: string }): Promise<BackfillPage> {
  const response = await gatewayInternalFetch("/internal/v1/actions/activity/page", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ envelope: input.envelope, publicationUrl: input.publicationUrl, filter: "all", ...(input.after === null ? {} : { after: input.after }) }),
  });
  if (!response.ok) {
    const header = response.headers.get("Retry-After");
    const seconds = header === null ? NaN : Number(header);
    const retryAt = Number.isFinite(seconds) ? Date.now() + Math.max(60, seconds) * 1000 : Math.max(Date.now() + 60_000, header ? Date.parse(header) || 0 : 0);
    throw new ActivityBackfillReadError(retryAt, response.status === 429 ? "Substack rate limit reached. Import paused; resume after the cooldown." : `Activity gateway returned ${response.status}. Import paused; your cursor is preserved.`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("Invalid historical activity response.");
  return parseActivityBackfillPage(body.data, input.after, input.cutoff);
}

const ACTIVITY_ITEM_KEYS = [
  "id",
  "kind",
  "createdAt",
  "senderCount",
  "isNew",
  "actorName",
  "actorHandle",
  "actorAvatarUrl",
  "commentId",
  "commentBody",
  "commentAuthorId",
  "ancestorPath",
  "rootCommentId",
  "targetKind",
  "targetTitle",
  "targetBody",
  "targetAuthorName",
  "targetAuthorHandle",
  "targetUrl",
  "targetReactionCount",
  "targetRestackCount",
  "targetReplyCount",
  "targetViewerLiked",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function nullableText(value: unknown, maxLength: number) {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function nullableCount(value: unknown) {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** Validates the normalized, allow-listed representation stored in the response cache. */
export function validateGatewayActivityResult(value: unknown): GatewayActivityItem[] {
  if (!Array.isArray(value) || value.length > MAX_ACTIVITY_ITEMS) {
    throw new Error("Invalid activity result.");
  }

  return value.map((item) => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ACTIVITY_ITEM_KEYS) ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      item.id.length > 512 ||
      typeof item.kind !== "string" ||
      item.kind.length === 0 ||
      item.kind.length > 64 ||
      !nullableText(item.createdAt, 128) ||
      (item.senderCount !== null &&
        (typeof item.senderCount !== "number" ||
          !Number.isSafeInteger(item.senderCount) ||
          item.senderCount < 0)) ||
      typeof item.isNew !== "boolean" ||
      !nullableText(item.actorName, 256) ||
      !nullableText(item.actorHandle, 256) ||
      !nullableText(item.actorAvatarUrl, 2_048) ||
      !nullableText(item.commentId, 512) ||
      !nullableText(item.commentBody, 10_000) ||
      !nullableText(item.commentAuthorId, 512) ||
      !Array.isArray(item.ancestorPath) ||
      item.ancestorPath.length > 32 ||
      !item.ancestorPath.every((id) => typeof id === "string" && id.length > 0 && id.length <= 512) ||
      !nullableText(item.rootCommentId, 512) ||
      (item.targetKind !== null &&
        item.targetKind !== "post" &&
        item.targetKind !== "note" &&
        item.targetKind !== "comment") ||
      !nullableText(item.targetTitle, 500) ||
      !nullableText(item.targetBody, 10_000) ||
      !nullableText(item.targetAuthorName, 256) ||
      !nullableText(item.targetAuthorHandle, 256) ||
      !nullableText(item.targetUrl, 2_048) ||
      !nullableCount(item.targetReactionCount) ||
      !nullableCount(item.targetRestackCount) ||
      !nullableCount(item.targetReplyCount) ||
      (item.targetViewerLiked !== null && typeof item.targetViewerLiked !== "boolean")
    ) {
      throw new Error("Invalid activity result.");
    }

    return item as GatewayActivityItem;
  });
}

function activityItemId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && value.trim() && value.length <= 512) return value.trim();
  return null;
}

function nullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) return null;
  return value.trim();
}

/** Indexes an array (or id-keyed record) of upstream records by their numeric or string id. */
function indexById(entries: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const id = activityItemId(entry.id);
      if (id !== null) map.set(id, entry);
    }
  } else if (isRecord(entries)) {
    for (const [id, entry] of Object.entries(entries)) {
      if (isRecord(entry) && activityItemId(id) !== null) map.set(id, entry);
    }
  }
  return map;
}

function commentText(comment: Record<string, unknown>): string | null {
  const body = nullableString(comment.body, 10_000) ?? nullableString(comment.body_text, 10_000);
  if (body) return body;
  const document = parseNoteDocument(comment.body_json ?? comment.bodyJson);
  return document ? noteDocumentText(document).trim() || null : null;
}

function commentAuthorId(comment: Record<string, unknown>): string | null {
  const user = isRecord(comment.user) ? comment.user : null;
  return activityItemId(user?.id) ?? activityItemId(comment.user_id);
}

function commentAuthorName(comment: Record<string, unknown>): string | null {
  const user = isRecord(comment.user) ? comment.user : null;
  return nullableString(comment.name, 256) ?? nullableString(user?.name, 256);
}

function commentAuthorHandle(comment: Record<string, unknown>): string | null {
  const user = isRecord(comment.user) ? comment.user : null;
  return nullableString(comment.handle, 256) ?? nullableString(user?.handle, 256);
}

function commentPhotoUrl(comment: Record<string, unknown>): string | null {
  const user = isRecord(comment.user) ? comment.user : null;
  return safeNoteUrl(comment.photo_url) ?? safeNoteUrl(user?.photo_url) ?? safeNoteUrl(user?.avatar_url);
}

function commentAncestorPath(comment: Record<string, unknown>): string[] {
  const raw = nullableString(comment.ancestor_path, 2_048);
  if (!raw) return [];
  return raw
    .split(".")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 512)
    .slice(0, 32);
}

function noteUrl(handle: string | null, id: string): string | null {
  if (!handle) return null;
  const resource = String(id);
  const noteId = resource.startsWith("c-") ? resource : `c-${resource}`;
  return `https://substack.com/@${encodeURIComponent(handle)}/note/${encodeURIComponent(noteId)}`;
}

function countValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function commentEngagement(comment: Record<string, unknown>) {
  return {
    reactionCount:
      countValue(comment.reaction_count) ??
      countValue(isRecord(comment.reactions) ? comment.reactions.total : undefined),
    restackCount: countValue(comment.restacks),
    replyCount: countValue(comment.children_count),
    viewerLiked:
      comment.reaction === "❤" ? true : comment.viewer_has_liked === true ? true : null,
  };
}

function parseActivityItem(
  value: unknown,
  users: Map<string, Record<string, unknown>>,
  comments: Map<string, Record<string, unknown>>,
  posts: Map<string, Record<string, unknown>>,
): GatewayActivityItem | null {
  if (!isRecord(value)) return null;

  const id = activityItemId(value.id) ?? activityItemId(value.item_key);
  if (id === null) return null;

  const senders = Array.isArray(value.recent_sender_ids) ? value.recent_sender_ids : [];
  const senderId = activityItemId(senders[0]);
  const actor = senderId !== null ? users.get(senderId) : undefined;
  const inlineActor = isRecord(actor?.user) ? actor.user : undefined;

  const commentId = activityItemId(value.comment_id);
  const ownComment = commentId !== null ? comments.get(commentId) : undefined;
  const commentAuthor = ownComment ? isRecord(ownComment.user) ? ownComment.user : undefined : undefined;

  const postId = activityItemId(value.target_post_id);
  const post = postId !== null ? posts.get(postId) : undefined;
  const targetCommentId = activityItemId(value.target_comment_id);
  const targetComment = targetCommentId !== null ? comments.get(targetCommentId) : undefined;
  const targetCommentAuthor = targetComment && isRecord(targetComment.user) ? targetComment.user : undefined;

  const ancestorPath = ownComment ? commentAncestorPath(ownComment) : [];
  const rootCommentId =
    ancestorPath.length > 0
      ? ancestorPath[0]
      : commentId !== null && targetCommentId !== null
        ? targetCommentId
        : null;

  let targetKind: GatewayActivityItem["targetKind"] = null;
  let targetTitle: string | null = null;
  let targetBody: string | null = null;
  let targetAuthorName: string | null = null;
  let targetAuthorHandle: string | null = null;
  let targetUrl: string | null = null;
  let targetReactionCount: number | null = null;
  let targetRestackCount: number | null = null;
  let targetReplyCount: number | null = null;
  let targetViewerLiked: boolean | null = null;

  if (targetComment) {
    const isRootNote = commentAncestorPath(targetComment).length === 0;
    targetKind = isRootNote ? "note" : "comment";
    targetBody = commentText(targetComment);
    targetAuthorName = commentAuthorName(targetComment);
    targetAuthorHandle = commentAuthorHandle(targetComment);
    targetUrl = noteUrl(targetAuthorHandle, targetCommentId as string);
    const engagement = commentEngagement(targetComment);
    targetReactionCount = engagement.reactionCount;
    targetRestackCount = engagement.restackCount;
    targetReplyCount = engagement.replyCount;
    targetViewerLiked = engagement.viewerLiked;
  } else if (post) {
    targetKind = "post";
    targetTitle = nullableString(post.title, 500);
    targetBody = nullableString(post.subtitle, 10_000);
    targetUrl = safeNoteUrl(post.canonical_url) ?? safeNoteUrl(post.url);
  }

  return {
    id,
    kind: nullableString(value.type, 64) ?? "activity",
    createdAt: nullableString(value.created_at, 128),
    senderCount:
      typeof value.sender_count === "number" && Number.isSafeInteger(value.sender_count) && value.sender_count > 0
        ? value.sender_count
        : senders.length > 0
          ? senders.length
          : null,
    isNew: value.isNew === true,
    actorName:
      nullableString(actor?.name, 256) ??
      nullableString(commentAuthor?.name, 256) ??
      nullableString(inlineActor?.name, 256),
    actorHandle:
      nullableString(actor?.handle, 256) ??
      nullableString(commentAuthor?.handle, 256) ??
      nullableString(inlineActor?.handle, 256),
    actorAvatarUrl:
      safeNoteUrl(actor?.photo_url) ??
      safeNoteUrl(actor?.avatar_url) ??
      commentPhotoUrl(ownComment ?? {}) ??
      safeNoteUrl(inlineActor?.photo_url),
    commentId,
    commentBody: ownComment ? commentText(ownComment) : null,
    commentAuthorId: ownComment ? commentAuthorId(ownComment) : null,
    ancestorPath,
    rootCommentId,
    targetKind,
    targetTitle,
    targetBody,
    targetAuthorName,
    targetAuthorHandle,
    targetUrl,
    targetReactionCount,
    targetRestackCount,
    targetReplyCount,
    targetViewerLiked,
  };
}

/** Tolerant parser: unknown or malformed items are skipped instead of failing the read. */
export function parseGatewayActivityResult(value: unknown): GatewayActivityItem[] {
  if (!isRecord(value)) throw new Error("Invalid activity result.");
  const items = Array.isArray(value.activityItems) ? value.activityItems : null;
  if (!items) throw new Error("Invalid activity result.");

  const users = indexById(value.users);
  const comments = indexById(value.comments);
  const posts = indexById(value.posts);

  const parsed: GatewayActivityItem[] = [];
  for (const item of items.slice(0, MAX_ACTIVITY_ITEMS)) {
    const normalized = parseActivityItem(item, users, comments, posts);
    if (normalized) parsed.push(normalized);
  }
  return parsed;
}

/** Expands only supplied identities; totals never stand in for missing people. */
export function parseGatewayRelationshipActivityResult(value: unknown): GatewayActivityItem[] {
  if (!isRecord(value) || !Array.isArray(value.activityItems) || value.activityItems.length > MAX_ACTIVITY_ITEMS) throw new Error("Invalid activity result.");
  const users = indexById(value.users);
  const comments = indexById(value.comments);
  const posts = indexById(value.posts);
  const parsed: GatewayActivityItem[] = [];
  for (const raw of value.activityItems) {
    const base = parseActivityItem(raw, users, comments, posts);
    if (!base || !isRecord(raw)) continue;
    const senders = Array.isArray(raw.recent_sender_ids) ? [...new Set(raw.recent_sender_ids.map(activityItemId).filter((id): id is string => id !== null))] : [];
    // A comment/reply has one actual author, not one comment per sender.
    if (!senders.length || /comment|reply|restack_quote/.test(base.kind) && base.commentId && !/like|reaction/.test(base.kind)) {
      parsed.push(base);
      continue;
    }
    for (const sender of senders) {
      const actor = users.get(sender);
      const nested = isRecord(actor?.user) ? actor.user : null;
      const handle = nullableString(actor?.handle, 256) ?? nullableString(nested?.handle, 256);
      if (!handle) continue;
      parsed.push({ ...base, id: `${base.id}:sender:${sender}`, actorHandle: handle,
        actorName: nullableString(actor?.name, 256) ?? nullableString(nested?.name, 256),
        actorAvatarUrl: safeNoteUrl(actor?.photo_url) ?? safeNoteUrl(actor?.avatar_url) ?? safeNoteUrl(nested?.photo_url) });
      if (parsed.length > 5000) throw new Error("Expanded activity page exceeds the safe import limit.");
    }
  }
  return parsed;
}

/** Fetches the authenticated activity feed through the private gateway. */
export async function getGatewayActivity(
  {
    envelope,
    publicationUrl,
    allSenders = false,
  }: {
    envelope: ConnectionEnvelope;
    publicationUrl: string;
    allSenders?: boolean;
  },
): Promise<GatewayActivityItem[]> {
  const response = await gatewayInternalFetch("/internal/v1/actions/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicationUrl,
      envelope,
      filter: "all",
    }),
  });

  if (!response.ok) throw new Error("Gateway activity request was rejected.");

  const body: unknown = await response.json();
  if (!isRecord(body) || !("data" in body)) {
    throw new Error("Gateway activity request returned an invalid response.");
  }

  return allSenders ? parseGatewayRelationshipActivityResult(body.data) : parseGatewayActivityResult(body.data);
}
