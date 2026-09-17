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
  tags?: PersonTag[]
  lists?: PersonList[]
}

export interface ListRecord {
  id: string
  name: string
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
  direction: "inbound" | "outbound"
  actionType: "like" | "restack" | "comment" | "reply" | string
  targetType: string | null
  targetId: string | null
  targetTitle: string | null
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
  | "conversations"
  | "inbound"
  | "outbound"
  | "opportunities"
  | "no-history"

export type PeopleSort =
  | "engagement"
  | "recent_conversation"
  | "recent_interaction"
  | "name"
  | "inbound"
  | "outbound"
