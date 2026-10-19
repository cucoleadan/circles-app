export type ConnectionProfile = {
  id: string | number | null;
  name: string | null;
  handle: string | null;
};

export type ConnectionSummary = {
  id: string;
  publicationUrl: string | null;
  profile: ConnectionProfile;
  lastVerifiedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CompanionList = {
  id: string;
  name: string;
  description: string | null;
};

export type CompanionMember = {
  handle: string;
  name: string;
  lists: Array<{ id: string; name: string }>;
};

export type AppState = {
  connection: ConnectionSummary | null;
  lists: CompanionList[];
  handles?: string[];
  members?: CompanionMember[];
  user?: { id: string; email: string };
};

export type DetectedProfile = {
  handle: string;
  name: string | null;
  pageUrl: string;
};

export type FlowState =
  | { phase: "idle" }
  | { phase: "waiting-substack-login"; flowId: string; startedAt: number }
  | { phase: "asking-publication"; flowId: string; startedAt: number }
  | { phase: "sending"; flowId: string }
  | { phase: "done"; flowId: string; profile: ConnectionProfile | null }
  | { phase: "failed"; flowId: string; message: string; needsAuth?: boolean };

export type PopupRequest =
  | { type: "GET_STATUS" }
  | { type: "START_CONNECT_FLOW" }
  | { type: "connect-from-app" }
  | { type: "APP_PAGE_LOADED" }
  | { type: "SUBMIT_PUBLICATION_URL"; flowId: string; publicationUrl: string | null }
  | { type: "ADD_FEED_PERSON"; handle: string; name: string; lists: string[] }
  | { type: "GET_CRM_STATUS"; handle: string }
  | { type: "GET_CURRENT_PROFILE" }
  | { type: "FETCH_LISTS" }
  | { type: "CAPTURE_ACTIVITY_BATCH"; payload: unknown }
  | { type: "ADD_TO_LISTS"; name: string; handle: string; lists: string[]; tags: string[] }
  | { type: "APP_PAIRED" };

export type BackgroundResponse = {
  ok: boolean;
  queued?: boolean;
  pendingBatches?: number;
  message?: string;
  flow?: FlowState;
  profile?: DetectedProfile | null;
  lists?: CompanionList[];
  submit?: { ok: boolean; message?: string };
  needsAuth?: boolean;
  substackLoggedIn?: boolean;
  appState?: "connected" | "none" | "needsAuth" | "unreachable";
  appProfile?: string | null;
  appUserEmail?: string | null;
  appPublicationUrl?: string | null;
  alreadyInCrm?: boolean;
  inCrm?: boolean;
  memberLists?: Array<{ id: string; name: string }>;
  captured?: number;
  processedItems?: number;
  newInteractions?: number;
  enrichedInteractions?: number;
  newPeople?: number;
  updatedPeople?: number;
};

export type BridgeRequest =
  | { type: "BRIDGE_PING" }
  | { type: "GET_APP_STATE" }
  | { type: "POST_CONNECT"; sessionToken: string; publicationUrl: string | null }
  | { type: "POST_INSTALL" }
  | { type: "POST_ACTIVITY_BATCH"; payload: unknown }
  | { type: "POST_CREATE_PERSON"; name: string; handle: string; lists: string[]; tags: string[] };

export type BridgeResponse = {
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  appState?: AppState;
  submit?: { ok: boolean; message?: string };
  captured?: number;
  processedItems?: number;
  newInteractions?: number;
  enrichedInteractions?: number;
  newPeople?: number;
  updatedPeople?: number;
};

