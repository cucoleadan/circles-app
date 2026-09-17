import type { CommunityNoteReplies } from "../community/types";
import type { GatewayActivityItem } from "../../services/gateway/activity.server";
import type { CalendarNote } from "../scheduled-notes/types";
import { plainTextToNoteDocument } from "../notes/note-content";

export type ActivityKind = "comment" | "like" | "restack" | "follow" | "subscribe" | "mention" | "other";

export type NotificationItem = {
  id: string;
  kind: ActivityKind;
  actorName: string | null;
  actorHandle: string | null;
  actorAvatarUrl: string | null;
  createdAt: string | null;
  createdAtMs: number | null;
  senderCount: number | null;
  isNew: boolean;
  commentBody: string | null;
  commentId: string | null;
  ancestorDepth: number;
  rootCommentId: string | null;
  targetKind: GatewayActivityItem["targetKind"];
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

export type ActivityConversation = {
  rootCommentId: string;
  rootBody: string | null;
  rootUrl: string | null;
  rootReactionCount: number | null;
  rootRestackCount: number | null;
  rootReplyCount: number | null;
  rootViewerLiked: boolean | null;
  replies: NotificationItem[];
  ownerReplied: boolean;
};

export function classifyActivityKind(rawKind: string, hasComment: boolean): ActivityKind {
  if (hasComment) return "comment";
  const value = rawKind.toLowerCase();
  if (/restack/.test(value)) return "restack";
  if (/like|heart|reaction/.test(value)) return "like";
  if (/subscri/.test(value)) return "subscribe";
  if (/follow/.test(value)) return "follow";
  if (/mention|tag/.test(value)) return "mention";
  if (/comment|reply/.test(value)) return "comment";
  return "other";
}

function activityTimestampMs(createdAt: string | null) {
  if (!createdAt) return null;
  const milliseconds = Date.parse(createdAt);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function toNotificationItem(item: GatewayActivityItem): NotificationItem {
  return {
    id: item.id,
    kind: classifyActivityKind(item.kind, item.commentBody !== null || item.commentId !== null),
    actorName: item.actorName,
    actorHandle: item.actorHandle,
    actorAvatarUrl: item.actorAvatarUrl,
    createdAt: item.createdAt,
    createdAtMs: activityTimestampMs(item.createdAt),
    senderCount: item.senderCount,
    isNew: item.isNew,
    commentBody: item.commentBody,
    commentId: item.commentId,
    ancestorDepth: item.ancestorPath.length,
    rootCommentId: item.rootCommentId,
    targetKind: item.targetKind,
    targetTitle: item.targetTitle,
    targetBody: item.targetBody,
    targetAuthorName: item.targetAuthorName,
    targetAuthorHandle: item.targetAuthorHandle,
    targetUrl: item.targetUrl,
    targetReactionCount: item.targetReactionCount,
    targetRestackCount: item.targetRestackCount,
    targetReplyCount: item.targetReplyCount,
    targetViewerLiked: item.targetViewerLiked,
  };
}

/** Every activity item as a typed notification, newest first, excluding uninteresting kinds. */
export function deriveNotifications(items: GatewayActivityItem[]): NotificationItem[] {
  return items
    .map(toNotificationItem)
    .filter((item) => item.kind !== "other")
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

/**
 * Groups comment activity into conversations keyed by the root note they reply to.
 * Threads are ordered by their newest reply; replies within a thread are chronological.
 */
export function deriveConversations(items: GatewayActivityItem[]): ActivityConversation[] {
  const byRoot = new Map<string, NotificationItem[]>();
  for (const item of deriveNotifications(items)) {
    if (item.kind !== "comment" || item.rootCommentId === null) continue;
    const thread = byRoot.get(item.rootCommentId);
    if (thread) {
      thread.push(item);
    } else {
      byRoot.set(item.rootCommentId, [item]);
    }
  }

  return [...byRoot.entries()]
    .map(([rootCommentId, rawReplies]) => {
      const replies = [...rawReplies].sort(
        (a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0),
      );
      const firstReply = replies.find((reply) => reply.ancestorDepth === 1);
      return {
        rootCommentId,
        rootBody: firstReply?.targetBody ?? null,
        rootUrl: firstReply?.targetUrl ?? null,
        rootReactionCount: firstReply?.targetReactionCount ?? null,
        rootRestackCount: firstReply?.targetRestackCount ?? null,
        rootReplyCount: firstReply?.targetReplyCount ?? null,
        rootViewerLiked: firstReply?.targetViewerLiked ?? null,
        replies,
        ownerReplied: false,
      };
    })
    .sort(
      (a, b) =>
        (b.replies[b.replies.length - 1]?.createdAtMs ?? 0) -
        (a.replies[a.replies.length - 1]?.createdAtMs ?? 0),
    );
}

/** True when any comment in the full reply tree was authored by the publication owner. */
export function threadHasOwnerReply(
  replies: CommunityNoteReplies,
  ownerId: string | null,
  ownerHandle: string | null,
): boolean {
  const normalizedHandle = ownerHandle?.toLowerCase() ?? null;
  const visit = (comments: CommunityNoteReplies["comments"]): boolean => {
    for (const comment of comments) {
      if (
        (ownerId !== null && comment.authorId === ownerId) ||
        (normalizedHandle !== null &&
          comment.authorHandle !== null &&
          comment.authorHandle.toLowerCase() === normalizedHandle)
      ) {
        return true;
      }
      if (comment.children.length > 0 && visit(comment.children)) return true;
    }
    return false;
  };
  return visit(replies.comments);
}

/** Adapts an activity conversation into the calendar-note shape the in-app viewer expects. */
export function conversationToCalendarNote(conversation: ActivityConversation): CalendarNote {
  const body = conversation.rootBody ?? "";
  const hasCounters =
    conversation.rootReactionCount !== null ||
    conversation.rootRestackCount !== null ||
    conversation.rootReplyCount !== null;
  return {
    id: conversation.rootCommentId,
    recordId: conversation.rootCommentId,
    title: null,
    remoteDraftId: null,
    remoteNoteId: conversation.rootCommentId,
    body,
    document: body ? plainTextToNoteDocument(body) : null,
    triggerAt: null,
    plannedFor: null,
    scheduledAt: null,
    publishedAt: null,
    hasImage: false,
    images: [],
    attachmentIds: [],
    sharedContent: null,
    restackType: null,
    restackFriendName: null,
    source: "substack",
    status: "published",
    noteType: null,
    tags: [],
    metrics: hasCounters
      ? {
          views: 0,
          likes: conversation.rootReactionCount ?? 0,
          replies: conversation.rootReplyCount ?? 0,
          restacks: conversation.rootRestackCount ?? 0,
          capturedAt: new Date(0).toISOString(),
        }
      : null,
  };
}
