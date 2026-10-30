import {
  AUTO_CONNECT_COOLDOWN_MS,
  CONNECT_FLOW_TIMEOUT_MS,
  CONNECT_POLL_INTERVAL_MS,
} from "./lib/constants";
import { getSubstackSessionValue, hasSubstackSession } from "./lib/cookies";
import { detectProfileFromTab } from "./lib/detect";
import { requestViaBridge, requestConnectBridge } from "./lib/app-bridge";
import {
  APP_ORIGIN_STORAGE_KEY,
  grantedAppOrigin,
  isAppOriginUrl,
  originFromPattern,
  originPattern,
  setAppOrigin,
  syncAppContentScript,
} from "./lib/app-origin";
import { recoveredFlow } from "./lib/connection-status";
import { ACTIVITY_RETRY_ALARM, drainActivity, enqueueActivity, rememberActivityConnection } from "./lib/activity-queue";
import { runBrowserReads } from "./lib/browser-reads";
import type {
  BackgroundResponse,
  BridgeRequest,
  BridgeResponse,
  FlowState,
  PopupRequest,
} from "./lib/types";

let flow: FlowState = { phase: "idle" };
let pendingPublicationUrl: { flowId: string; url: string | null } | null = null;
let crmHandles: Set<string> | null = null;
let crmMembers: Map<string, { name: string; lists: Array<{ id: string; name: string }> }> | null = null;
let appStateRequest: Promise<BridgeResponse> | null = null;
let connectRequest: Promise<FlowState> | null = null;

const PUBLICATION_ASK_TIMEOUT_MS = 120_000;
const APP_STATE_CACHE_KEY = "appStateCache";
const APP_STATE_SUCCESS_TTL_MS = 30_000;
const APP_STATE_ERROR_TTL_MS = 0;

type AppStateCache = {
  response: BridgeResponse;
  expiresAt: number;
};

function populateMemberCache(state: BridgeResponse) {
  if (!state.ok || !state.appState) return;
  const handles = new Set<string>();
  const members = new Map<string, { name: string; lists: Array<{ id: string; name: string }> }>();

  for (const handle of state.appState.handles ?? []) {
    handles.add(handle.toLocaleLowerCase("en"));
  }

  for (const member of state.appState.members ?? []) {
    const key = member.handle.toLocaleLowerCase("en");
    handles.add(key);
    members.set(key, { name: member.name, lists: member.lists ?? [] });
  }

  crmHandles = handles;
  crmMembers = members;
}

function handlesFromAppState(state: BridgeResponse): Set<string> | null {
  if (!state.ok || !state.appState) return null;
  populateMemberCache(state);
  return crmHandles;
}

async function waitForPublicationUrl(flowId: string): Promise<string | null> {
  const deadline = Date.now() + PUBLICATION_ASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (pendingPublicationUrl && pendingPublicationUrl.flowId === flowId) {
      const { url } = pendingPublicationUrl;
      pendingPublicationUrl = null;
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  pendingPublicationUrl = null;
  return null;
}

async function readStoredFlow() {
  const stored = await chrome.storage.session.get("flow");
  if (stored.flow && typeof stored.flow === "object") {
    flow = stored.flow as FlowState;
    if (["waiting-substack-login", "asking-publication", "sending"].includes(flow.phase)) {
      await setFlow({ phase: "failed", flowId: "interrupted", message: "Connection was interrupted. Click Connect to retry." });
    }
  }
}

async function setFlow(next: FlowState): Promise<FlowState> {
  flow = next;
  await chrome.storage.session.set({ flow: next });
  void chrome.runtime
    .sendMessage({ type: "FLOW_CHANGED", flow: next })
    .catch(() => undefined);
  void grantedAppOrigin().then((origin) => origin ? chrome.tabs.query({ url: originPattern(origin) }) : []).then((tabs) => {
    for (const tab of tabs) if (tab.id) {
      void chrome.tabs.sendMessage(tab.id, { type: "FLOW_CHANGED", flow: next }).catch(() => undefined);
    }
  }).catch(() => undefined);
  return next;
}

function isSubstackPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "substack.com" || parsed.hostname.endsWith(".substack.com"));
  } catch {
    return false;
  }
}

async function requestAppState(force = false): Promise<BridgeResponse> {
  if (appStateRequest) return appStateRequest;

  appStateRequest = (async () => {
    if (!force) {
      const stored = await chrome.storage.session.get(APP_STATE_CACHE_KEY);
      const cached = stored[APP_STATE_CACHE_KEY] as AppStateCache | undefined;
      if (cached?.expiresAt && cached.expiresAt > Date.now()) {
        await rememberActivityConnection(cached.response);
        return cached.response;
      }
    }

    const response = await requestViaBridge({ type: "GET_APP_STATE" });
    await rememberActivityConnection(response);
    const ttl = response.ok && response.appState
      ? APP_STATE_SUCCESS_TTL_MS
      : APP_STATE_ERROR_TTL_MS;
    await chrome.storage.session.set({
      [APP_STATE_CACHE_KEY]: { response, expiresAt: Date.now() + ttl },
    });
    return response;
  })();

  try {
    return await appStateRequest;
  } finally {
    appStateRequest = null;
  }
}

async function clearAppStateCache(): Promise<void> {
  crmHandles = null;
  crmMembers = null;
  await chrome.storage.session.remove(APP_STATE_CACHE_KEY);
}

async function rememberCrmHandle(
  handle: string,
  name?: string,
  listIds?: string[],
): Promise<void> {
  const normalized = handle.toLocaleLowerCase("en");
  crmHandles?.add(normalized);

  const stored = await chrome.storage.session.get(APP_STATE_CACHE_KEY);
  const cached = stored[APP_STATE_CACHE_KEY] as AppStateCache | undefined;
  const appState = cached?.response.appState;

  const allLists = appState?.lists ?? [];
  const assignedLists = listIds
    ? allLists.filter((list) => listIds.includes(list.id))
    : [];

  const existingMember = crmMembers?.get(normalized);
  const updatedLists = [
    ...(existingMember?.lists ?? []),
    ...assignedLists.filter(
      (assigned) => !(existingMember?.lists ?? []).some((item) => item.id === assigned.id),
    ),
  ];

  if (!crmMembers) crmMembers = new Map();
  crmMembers.set(normalized, {
    name: name ?? existingMember?.name ?? normalized,
    lists: updatedLists,
  });

  if (!appState) return;

  const handles = new Set(appState.handles ?? []);
  handles.add(normalized);

  const members = [...(appState.members ?? []).filter((m) => m.handle.toLocaleLowerCase("en") !== normalized)];
  members.push({
    handle: normalized,
    name: name ?? existingMember?.name ?? normalized,
    lists: updatedLists,
  });

  await chrome.storage.session.set({
    [APP_STATE_CACHE_KEY]: {
      ...cached,
      response: {
        ...cached.response,
        appState: { ...appState, handles: [...handles], members },
      },
    },
  });
}

async function openOrFocusSubstackTab(focus: boolean): Promise<chrome.tabs.Tab> {
  const existing = await chrome.tabs.query({ url: "https://*.substack.com/*" });
  const candidate = existing[0];
  if (candidate?.id) {
    if (focus) {
      await chrome.tabs.update(candidate.id, { active: true });
    }
    return candidate;
  }
  return chrome.tabs.create({
    url: "https://substack.com/signin",
    ...(focus ? {} : { active: false }),
  });
}

async function waitForSubstackSession(): Promise<boolean> {
  const deadline = Date.now() + CONNECT_FLOW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await hasSubstackSession()) return true;
    await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_INTERVAL_MS));
  }
  return false;
}

async function runConnectFlow(options?: {
  focusSubstack?: boolean;
  askPublication?: boolean;
}): Promise<FlowState> {
  if (connectRequest) return connectRequest;
  connectRequest = performConnectFlow(options).catch(() => setFlow({ phase: "failed", flowId: "failed", message: "Connection failed. Please retry." }));
  try { return await connectRequest; } finally { connectRequest = null; }
}

async function performConnectFlow(options?: {
  focusSubstack?: boolean;
  askPublication?: boolean;
}): Promise<FlowState> {
  if (
    flow.phase === "waiting-substack-login" ||
    flow.phase === "asking-publication" ||
    flow.phase === "sending"
  ) {
    return flow;
  }

  const flowId = crypto.randomUUID();
  const startedAt = Date.now();

  // Verify the app before asking for publication details or opening Substack.
  const state = await requestConnectBridge({ type: "GET_APP_STATE" });
  if (!state.ok) {
    return setFlow({
      phase: "failed",
      flowId,
      message: state.needsAuth
        ? "Log in to Circles first."
        : state.message ?? "Could not connect to Circles.",
    });
  }

  let publicationUrl: string | null = null;
  if (options?.askPublication !== false) {
    await setFlow({ phase: "asking-publication", flowId, startedAt });
    publicationUrl = await waitForPublicationUrl(flowId);
  }

  await setFlow({ phase: "waiting-substack-login", flowId, startedAt });
  await openOrFocusSubstackTab(options?.focusSubstack ?? true);
  if (!(await waitForSubstackSession())) {
    return setFlow({
      phase: "failed",
      flowId,
      message: "Timed out waiting for a Substack login. Log in and try again.",
    });
  }

  const credential = await getSubstackSessionValue();
  if (!credential) {
    return setFlow({
      phase: "failed",
      flowId,
      message: "Could not read the Substack session cookie. Log in again and retry.",
    });
  }

  await setFlow({ phase: "sending", flowId });

  const result = await requestConnectBridge({
    type: "POST_CONNECT",
    sessionToken: credential,
    publicationUrl,
  });
  if (!result.ok || result.submit?.ok === false) {
    return setFlow({
      phase: "failed",
      flowId,
      message: result.message ?? result.submit?.message ?? "Connection failed.",
    });
  }

  await clearAppStateCache();

  return setFlow({ phase: "done", flowId, profile: null });
}

async function maybeAutoConnect(forceAppState = false): Promise<void> {
  if (flow.phase !== "idle") return;

  const stored = await chrome.storage.session.get("autoConnect");
  const lastAttemptAt = (stored.autoConnect as { lastAttemptAt?: number } | undefined)?.lastAttemptAt ?? 0;
  if (Date.now() - lastAttemptAt < AUTO_CONNECT_COOLDOWN_MS) return;
  await chrome.storage.session.set({ autoConnect: { lastAttemptAt: Date.now() } });

  const state = await requestAppState(forceAppState);
  if (!state.ok || !state.appState) return;
  if (state.appState.connection) return;
  if (!(await hasSubstackSession())) return;

  await runConnectFlow({ focusSubstack: false, askPublication: false });
}

async function handlePopupRequest(request: PopupRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case "APP_PAIRED":
      return onboardPairedApp();
    case "GET_STATUS": {
      void maybeAutoConnect();
      const [substackLoggedIn, app] = await Promise.all([
        hasSubstackSession(),
        requestAppState(true),
      ]);
      const appHandles = handlesFromAppState(app);
      const currentFlow = recoveredFlow(flow, Boolean(app.ok && app.appState?.connection), connectRequest !== null);
      if (currentFlow !== flow) await setFlow(currentFlow);
      if (appHandles) crmHandles = appHandles;
      let appState: "connected" | "none" | "needsAuth" | "unreachable" = "unreachable";
      let appProfile: string | null = null;
      let appUserEmail: string | null = null;
      if (app.ok && app.appState) {
        appState = app.appState.connection ? "connected" : "none";
        appProfile =
          app.appState.connection?.profile.name ??
          app.appState.connection?.profile.handle ??
          null;
        appUserEmail = app.appState.user?.email ?? null;
      } else if (app.needsAuth) {
        appState = "needsAuth";
      }
      return {
        ok: true,
        flow,
        substackLoggedIn,
        appState,
        appProfile,
        appUserEmail,
        appPublicationUrl: app.ok && app.appState ? app.appState.connection?.publicationUrl ?? null : null,
      };
    }
    case "GET_PANEL_STATUS": {
      // The side panel reads Circles itself; it only needs the local connect state.
      return { ok: true, flow, substackLoggedIn: await hasSubstackSession() };
    }
    case "START_CONNECT_FLOW":
      return { ok: true, flow: await runConnectFlow() };
    case "connect-from-app":
      return { ok: true, flow: await runConnectFlow() };
    case "APP_PAGE_LOADED":
      await clearAppStateCache();
      void drainActivity(requestViaBridge).catch((error) => console.warn("[Circles Activity] Queue retry failed.", error));
      void maybeAutoConnect(true);
      return { ok: true };
    case "SUBMIT_PUBLICATION_URL": {
      if (flow.phase !== "asking-publication" || flow.flowId !== request.flowId) {
        return { ok: false, message: "No connection is waiting for a publication URL." };
      }
      pendingPublicationUrl = {
        flowId: request.flowId,
        url: request.publicationUrl,
      };
      return { ok: true };
    }
    case "ADD_FEED_PERSON": {
      const handle = request.handle.trim().toLocaleLowerCase("en");
      const name = request.name.trim().replace(/\s+/g, " ").slice(0, 80);
      if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(handle)) {
        return { ok: false, message: "Invalid Substack handle." };
      }
      if (!name) {
        return { ok: false, message: "Could not read the author's name." };
      }
      const result = await requestConnectBridge({
        type: "POST_CREATE_PERSON",
        name,
        handle,
        lists: request.lists.slice(0, 20),
        tags: [],
      });
      const ok = result.ok && result.submit?.ok !== false;
      const message =
        result.submit?.message ?? result.message ?? (ok ? "Added." : "Failed.");
      if (ok) {
        await rememberCrmHandle(handle, name, request.lists);
      }
      return {
        ok,
        message,
        alreadyInCrm: !ok && /already/i.test(message),
        memberLists: crmMembers?.get(handle)?.lists ?? [],
      };
    }
    case "GET_CRM_STATUS": {
      const normalized = request.handle.trim().toLocaleLowerCase("en");
      if (!crmHandles || !crmMembers) {
        const app = await requestAppState();
        const appHandles = handlesFromAppState(app);
        if (appHandles) crmHandles = appHandles;
      }
      const inCrm = crmHandles?.has(normalized) ?? false;
      const memberLists = crmMembers?.get(normalized)?.lists ?? [];
      if (inCrm) {
        console.log(`[Circles Background] @${normalized} is in CRM with lists:`, memberLists);
      }
      return { ok: true, inCrm, memberLists };
    }
    case "GET_CURRENT_PROFILE": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { ok: true, profile: tab ? detectProfileFromTab(tab) : null };
    }
    case "FETCH_LISTS": {
      const state = await requestAppState();
      return {
        ok: state.ok,
        message: state.message,
        needsAuth: state.needsAuth,
        lists: state.appState?.lists ?? [],
      };
    }
    case "CAPTURE_ACTIVITY_BATCH": {
      await requestAppState();
      const queued = await enqueueActivity(request.payload);
      if (queued.ok) void drainActivity(requestViaBridge).catch((error) => console.warn("[Circles Activity] Delivery interrupted; pending data retained.", error));
      return queued;
    }
    case "ADD_TO_LISTS": {
      const handle = request.handle.trim().toLocaleLowerCase("en");
      const result = await requestViaBridge({
        type: "POST_CREATE_PERSON",
        name: request.name,
        handle,
        lists: request.lists,
        tags: request.tags,
      });
      const ok = result.ok && result.submit?.ok !== false;
      if (ok) await rememberCrmHandle(handle, request.name, request.lists);
      return {
        ok,
        message: result.message ?? result.submit?.message,
        submit: result.submit,
        memberLists: crmMembers?.get(handle)?.lists ?? [],
      };
    }
  }
}

chrome.runtime.onMessage.addListener(
  (request: PopupRequest, sender, sendResponse) => {
    if (request.type === "CAPTURE_ACTIVITY_BATCH" && !isSubstackPageUrl(sender.url)) {
      sendResponse({ ok: false, message: "Activity capture source was rejected." });
      return;
    }
    const fromApp = ["APP_PAGE_LOADED", "connect-from-app", "SUBMIT_PUBLICATION_URL"].includes(request.type);
    // The side panel may also submit a publication URL.
    const fromPanel = sender.url?.startsWith(chrome.runtime.getURL("sidepanel/")) ?? false;
    void (async () => {
      if (
        (fromApp && !fromPanel && !(await isAppOriginUrl(sender.url))) ||
        (request.type === "APP_PAIRED" && !fromPanel)
      ) {
        return { ok: false, message: "App message source was rejected." };
      }
      await initialized;
      return handlePopupRequest(request);
    })().then(sendResponse).catch(() => sendResponse({ ok: false, message: "Request failed; capture was not confirmed." }));
    return true;
  },
);

// Optional host access is only ever requested to pair a Circles server. The
// panel may lose its gesture while Chrome shows the prompt, so finish pairing here too.
chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  const origin = origins.map(originFromPattern).find((value): value is string => value !== null);
  if (origin) void setAppOrigin(origin).catch((error) => console.warn("[Circles] Could not pair the server.", error));
});

// A different Circles server means different CRM data; drop what was cached from the old one.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && APP_ORIGIN_STORAGE_KEY in changes) void clearAppStateCache();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ACTIVITY_RETRY_ALARM) {
    void drainActivity(requestViaBridge).catch((error) => console.warn("[Circles Activity] Queue retry interrupted.", error));
    void runBrowserReads();
  }
});

// Alarms may disappear on browser restart. Restore the periodic wake-up on worker start.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) => console.warn("[Circles Activity] Could not restrict capture storage access.", error));
void chrome.alarms.get(ACTIVITY_RETRY_ALARM).then((alarm) => {
  if (!alarm) return chrome.alarms.create(ACTIVITY_RETRY_ALARM, { periodInMinutes: 1 });
}).catch((error) => console.warn("[Circles Activity] Could not schedule retries.", error));

async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** After the user pairs a Circles server: open it, record the install, and connect Substack if needed. */
async function onboardPairedApp(): Promise<BackgroundResponse> {
  const origin = await grantedAppOrigin();
  if (!origin) return { ok: false, message: "Set your Circles server first." };
  const tab = await chrome.tabs.create({ url: origin });
  if (!tab.id) return { ok: false };
  await waitForTabLoad(tab.id, 20_000);
  await requestViaBridge({ type: "POST_INSTALL" });
  const state = await requestAppState();
  if (state.ok && state.appState && !state.appState.connection) {
    await runConnectFlow();
  }
  return { ok: true };
}

chrome.runtime.onInstalled.addListener((details) => {
  // Re-register the app bridge for the paired server on install and every update.
  void syncAppContentScript().catch((error) => console.warn("[Circles] Could not register the app bridge.", error));
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/index.html") });
  }
});

// The toolbar icon opens the side panel; there is no popup.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("[Circles] Could not enable the side panel.", error));

const initialized = readStoredFlow();
