export interface PersonTag {
  id: string
  name: string
  color: string | null
}

export interface PersonList {
  id: string
  name: string
}

export interface Person {
  id: string
  name: string
  handle: string | null
  notes: string | null
  relationshipStatus: "new" | "active" | "close" | "dormant" | string | null
  substackProfileId: string | null
  profileUrl: string | null
  publicationUrl?: string | null
  avatarUrl?: string | null
  source: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  interactionCount: number
  conversationCount: number
  engagementScore: number
  inboundInteractionCount: number
  outboundInteractionCount: number
  outboundEngagementScore: number
  firstInteractedAt: string | null
  lastInteractionAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  lastConversationAt: string | null
  driftStatus: "new" | "active" | "drifting" | "cold" | string
  lastActionType?: string | null
  lastActionDirection?: string | null
  lastInboundCommentAt?: string | null
  lastOutboundCommentAt?: string | null
  lastOutboundLikeAt?: string | null
  likeCount?: number
  restackCount?: number
  commentCount?: number
  tags?: PersonTag[]
  lists?: PersonList[]
}

export interface ListRecord {
  id: string
  name: string
  description?: string | null
  createdAt: string
  count: number
}

export interface TagRecord {
  id: string
  name: string
  color: string | null
  createdAt: string
}

export interface CirclesOverview {
  people: number
  byStatus: Record<string, number>
  byDrift: Record<string, number>
  interactions: number
}

export interface Interaction {
  id: string
  personId: string | null
  externalId: string
  source: "extension" | "sdk" | "import" | string
  direction: "inbound" | "outbound"
  actionType: "comment" | "reply" | "like" | "restack" | "subscribe" | "mention" | "other" | string
  targetType: "post" | "note" | "comment" | "profile" | string | null
  targetId: string | null
  targetTitle: string | null
  targetBody: string | null
  targetUrl: string | null
  threadKind: "post" | "note" | string | null
  threadRootId: string | null
  body: string | null
  occurredAt: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type PeopleView =
  | "all"
  | "needs-reply"
  | "awaiting-response"
  | "mutual"
  | "priority"
  | "conversations"
  | "inbound"
  | "outbound"
  | "opportunities"
  | "no-history"

export type PeopleSort =
  | "engagement"
  | "engagement_asc"
  | "recent_conversation"
  | "recent_interaction"
  | "recent_interaction_desc"
  | "recent_interaction_asc"
  | "name"
  | "inbound"
  | "inbound_desc"
  | "inbound_asc"
  | "outbound"
  | "outbound_desc"
  | "outbound_asc"
  | "priority"

export type DateRangePreset = "all" | "7d" | "14d" | "30d" | "90d"

export interface PriorityQueueSettings {
  minInbound: number
  maxOutbound: number
  minRestacks: number
  driftingMinDays: number
  driftingMaxDays: number
  vipScoreThreshold: number
}

export interface UserSettings {
  priorityQueue: PriorityQueueSettings
}

