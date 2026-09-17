import { plainTextToNoteDocument } from "../notes/note-content";
import { timelineLink } from "./conversation-timeline";
import type { CommunityContentNote, CommunityContentPost, CommunityContentProfile, CommunityInteraction } from "./types";

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** A saved target is not the interacting person's own content. Never infer its author. */
export function interactionContent(item: CommunityInteraction):
  | { kind: "post"; post: CommunityContentPost; profile?: CommunityContentProfile }
  | { kind: "note"; note: CommunityContentNote; profile?: CommunityContentProfile }
  | null {
  const metadata = item.metadata ?? {};
  const body = text(metadata.targetBody);
  const title = text(item.targetTitle) ?? text(metadata.targetTitle);
  const url = timelineLink(item.targetUrl);
  const handle = text(metadata.targetAuthorHandle);
  const name = text(metadata.targetAuthorName);
  const profile = handle ? { id: handle, name, handle, photoUrl: null, bio: null } : undefined;
  const id = item.targetId ?? item.externalId;
  if (item.targetType === "post" && title) return {
    kind: "post", profile,
    post: { id, title, subtitle: body, url, publishedAt: null,
      reactionCount: count(metadata.targetReactionCount), commentCount: count(metadata.targetReplyCount), restackCount: count(metadata.targetRestackCount) },
  };
  if ((item.targetType === "note" || item.targetType === "comment") && body) return {
    kind: "note", profile,
    note: { id, body, document: plainTextToNoteDocument(body), url: url ?? "", images: [], sharedContent: null, createdAt: null,
      reactionCount: count(metadata.targetReactionCount), replyCount: count(metadata.targetReplyCount), restackCount: count(metadata.targetRestackCount), viewerHasLiked: null },
  };
  return null;
}
