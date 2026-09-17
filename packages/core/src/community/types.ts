export const COMMUNITY_COLORS = ["violet", "emerald", "amber", "sky", "rose", "slate"] as const;

export type CommunityColor = (typeof COMMUNITY_COLORS)[number];

export const COMMUNITY_STATUSES = [
  "new",
  "reach-out",
  "contacted",
  "conversation",
  "active",
  "archived",
] as const;

export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

export const COMMUNITY_STATUS_LABELS: Record<CommunityStatus, string> = {
  new: "New",
  "reach-out": "Reach out",
  contacted: "Contacted",
  conversation: "In conversation",
  active: "Active relationship",
  archived: "Archived",
};

export type CommunityLabel = {
  id: string;
  name: string;
  color: CommunityColor;
};

export type CommunityTag = CommunityLabel & {
  pinned: boolean;
};

export type CommunityListOption = {
  id: string;
  name: string;
};

export type CommunityList = CommunityListOption & {
  description: string | null;
  memberCount: number;
  pinned: boolean;
};

export const DRIFT_STATUSES = ["new", "active", "drifting", "cold"] as const;

export type DriftStatus = (typeof DRIFT_STATUSES)[number];

export const DRIFT_STATUS_LABELS: Record<DriftStatus, string> = {
  new: "New",
  active: "Active",
  drifting: "Drifting",
  cold: "Cold",
};

export type CommunityPerson = {
  id: string;
  name: string;
  handle: string;
  profileUrl: string;
  publicationUrl: string | null;
  status: CommunityStatus | null;
  notes: string | null;
  tags: CommunityLabel[];
  lists: CommunityListOption[];
  createdAt: string;
  updatedAt: string;
  lastEngagedAt: string | null;
  firstInteractedAt?: string | null;
  interactionCount?: number;
  conversationCount?: number;
  driftStatus?: DriftStatus;
  aiSummary?: string | null;
  aiSuggestedAction?: string | null;
  aiTopics?: string[];
  aiSummarizedAt?: string | null;
};

export type CommunityInteraction = {
  id: string;
  userId: string;
  personId: string | null;
  externalId: string;
  direction: "inbound" | "outbound";
  actionType: "comment" | "reply" | "like" | "restack" | "subscribe" | "mention" | "other";
  targetType: "post" | "note" | "comment" | "profile" | null;
  targetId: string | null;
  targetTitle: string | null;
  targetUrl: string | null;
  threadRootId: string | null;
  body: string | null;
  occurredAt: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

export type CommunityEngagement = {
  id: string;
  personId: string | null;
  targetId: string;
  targetType: "note" | "post" | "comment";
  actionType: "like" | "comment" | "reply" | "restack";
  metadata: {
    title?: string;
    body?: string;
    url?: string;
    authorName?: string;
    authorHandle?: string;
  } | null;
  createdAt: string;
};

export type CommunityPersonHandleEntry = {
  handle: string;
  name: string;
  lists: CommunityListOption[];
};

export type CommunityData = {
  people: CommunityPerson[];
  tags: CommunityTag[];
  lists: CommunityList[];
  engagements?: CommunityEngagement[];
  snapshots?: CommunityContentSnapshot[];
};

export type CommunityContentProfile = {
  id: string;
  name: string | null;
  handle: string;
  photoUrl: string | null;
  bio: string | null;
};

export type CommunityContentPost = {
  id: string;
  title: string;
  subtitle: string | null;
  url: string | null;
  publishedAt: string | null;
  coverImageUrl?: string | null;
  reactionCount?: number | null;
  commentCount?: number | null;
  restackCount?: number | null;
};

export type CommunityContentNoteImage = NoteImage;

export type CommunityContentNote = {
  id: string;
  body: string;
  document: NoteDocument;
  url: string;
  images: CommunityContentNoteImage[];
  sharedContent: NoteSharedContent | null;
  createdAt: string | null;
  reactionCount: number | null;
  restackCount: number | null;
  replyCount: number | null;
  viewerHasLiked: boolean | null;
};

export type CommunityNoteReply = {
  id: string;
  body: string;
  createdAt: string | null;
  authorName: string | null;
  authorHandle: string | null;
  authorPhotoUrl: string | null;
  authorId: string | null;
  children: CommunityNoteReply[];
};

export type CommunityNoteReplies = {
  noteId: string;
  comments: CommunityNoteReply[];
  moreComments: number;
};

export type CommunityContent = {
  profile: CommunityContentProfile;
  posts: CommunityContentPost[];
  notes: CommunityContentNote[];
};

export type CommunityContentSnapshot = {
  personId: string;
  content: CommunityContent | null;
  syncedAt: string | null;
  lastAttemptedAt: string;
  status: "pending" | "ready" | "stale" | "error";
};

export type CommunityContentCache = {
  status: "hit" | "miss" | "refreshed";
  cachedAt: string;
  expiresAt: string;
};

export type PinnedCommunityView = {
  id: string;
  kind: "tag" | "list";
  sourceId: string;
  name: string;
  color: CommunityColor | null;
  people: CommunityPerson[];
};

export type CommunityIntent =
  | "loadContent"
  | "refreshContent"
  | "loadNoteComments"
  | "setNoteReaction"
  | "commentOnNote"
  | "restackNote"
  | "replyToNoteComment"
  | "createPerson"
  | "updatePerson"
  | "deletePerson"
  | "createList"
  | "deleteList"
  | "togglePersonList"
  | "pinView"
  | "unpinView"
  | "syncRelationships";

export type CommunityActionResult =
  | {
      ok: true;
      intent: "syncRelationships";
      stats: {
        processedItems: number;
        newInteractions: number;
        newPeople: number;
        updatedPeople: number;
      };
    }
  | {
      ok: true;
      intent: Exclude<
        CommunityIntent,
        | "loadContent"
        | "refreshContent"
        | "loadNoteComments"
        | "setNoteReaction"
        | "commentOnNote"
        | "restackNote"
        | "replyToNoteComment"
        | "syncRelationships"
      >;
    }
  | {
      ok: true;
      intent: "loadContent" | "refreshContent";
      personId: string;
      content: CommunityContent;
      cache: CommunityContentCache;
      retryAt?: string;
    }
  | {
      ok: true;
      intent: "loadNoteComments";
      noteId: string;
      replies: CommunityNoteReplies;
    }
  | {
      ok: true;
      intent: "setNoteReaction";
      noteId: string;
      liked: boolean;
      reactionCount: number | null;
    }
  | {
      ok: true;
      intent: "commentOnNote";
      noteId: string;
      commentId: string | null;
    }
  | {
      ok: true;
      intent: "restackNote";
      noteId: string;
      restackCount: number | null;
    }
  | {
      ok: true;
      intent: "replyToNoteComment";
      noteId: string;
      parentCommentId: string;
      commentId: string | null;
    }
  | {
      ok: false;
      intent: CommunityIntent;
      message: string;
      noteId?: string;
      retryAt?: string;
    };
import type {
  NoteDocument,
  NoteImage,
  NoteSharedContent,
} from "../notes/note-content";
