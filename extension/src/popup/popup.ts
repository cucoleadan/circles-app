import type {
  BackgroundResponse,
  DetectedProfile,
  FlowState,
} from "../lib/types";

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const substackDot = byId<HTMLSpanElement>("substack-dot");
const substackText = byId<HTMLParagraphElement>("substack-text");
const appDot = byId<HTMLSpanElement>("app-dot");
const appText = byId<HTMLParagraphElement>("app-text");
const connectBtn = byId<HTMLButtonElement>("connect-btn");
const flowText = byId<HTMLParagraphElement>("flow-text");
const askSection = byId<HTMLElement>("ask-section");
const pubInput = byId<HTMLInputElement>("pub-input");
const pubError = byId<HTMLParagraphElement>("pub-error");
const pubSkipBtn = byId<HTMLButtonElement>("pub-skip-btn");
const pubSubmitBtn = byId<HTMLButtonElement>("pub-submit-btn");
const profileLine = byId<HTMLParagraphElement>("profile-line");
const handleInput = byId<HTMLInputElement>("handle-input");
const listsContainer = byId<HTMLDivElement>("lists-container");
const tagsInput = byId<HTMLInputElement>("tags-input");
const addBtn = byId<HTMLButtonElement>("add-btn");
const actionText = byId<HTMLParagraphElement>("action-text");
const extensionVersion = byId<HTMLSpanElement>("extension-version");

extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;

let profile: DetectedProfile | null = null;
let lists: { id: string; name: string }[] = [];
let flow: FlowState = { phase: "idle" };
let appPublicationUrl: string | null = null;

async function send(request: Record<string, unknown>): Promise<BackgroundResponse> {
  try { return (await chrome.runtime.sendMessage(request)) as BackgroundResponse; }
  catch { return { ok: false, message: "Extension restarted. Reopen the popup and retry." }; }
}

function setDot(dot: HTMLElement, state: "unknown" | "ok" | "bad") {
  dot.className = `dot${state === "ok" ? " ok" : state === "bad" ? " bad" : ""}`;
}

function flowLabel(state: FlowState): string {
  switch (state.phase) {
    case "waiting-substack-login":
      return "Waiting for you to log in on Substack…";
    case "asking-publication":
      return "Add your publication URL to finish connecting.";
    case "sending":
      return "Encrypting and sending your session…";
    case "done":
      return "Connected to StackedHQ.";
    case "failed":
      return state.message;
    case "idle":
      return "";
  }
}

function flowHintClass(state: FlowState): string {
  if (state.phase === "done") return "ok";
  if (state.phase === "failed") return "bad";
  if (
    state.phase === "waiting-substack-login" ||
    state.phase === "asking-publication" ||
    state.phase === "sending"
  ) {
    return "warn";
  }
  return "";
}

const PUBLICATION_URL_PATTERN =
  /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.substack\.com\/?$/i;

function validPublicationUrl(value: string): boolean {
  const clean = value.trim();
  return clean.length === 0 || PUBLICATION_URL_PATTERN.test(clean);
}

async function submitPublicationUrl(publicationUrl: string | null) {
  if (flow.phase !== "asking-publication") return;
  pubError.classList.add("hidden");
  await send({
    type: "SUBMIT_PUBLICATION_URL",
    flowId: flow.flowId,
    publicationUrl,
  });
  pubInput.value = "";
}

function renderFlow() {
  flowText.textContent = flowLabel(flow);
  flowText.className = `hint ${flowHintClass(flow)}`;
  const busy =
    flow.phase === "waiting-substack-login" ||
    flow.phase === "asking-publication" ||
    flow.phase === "sending";
  connectBtn.disabled = busy;
  connectBtn.textContent = busy ? "Connecting…" : "Connect Substack account";
  askSection.classList.toggle("hidden", flow.phase !== "asking-publication");
  if (flow.phase === "asking-publication") {
    if (!pubInput.value && appPublicationUrl) {
      pubInput.value = appPublicationUrl;
    }
    pubInput.focus();
  }
}

function renderProfile() {
  if (profile) {
    profileLine.textContent = `Adding @${profile.handle}${profile.name ? ` (${profile.name})` : ""}`;
    profileLine.className = "hint";
    handleInput.value = profile.handle;
    handleInput.disabled = true;
    addBtn.disabled = true;
  } else {
    profileLine.textContent = "Open a profile on substack.com, or type a handle.";
    profileLine.className = "hint";
    handleInput.value = "";
    handleInput.disabled = false;
  }
  updateAddButton();
}

function renderLists() {
  listsContainer.textContent = "";
  if (lists.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No lists yet. Create lists in the StackedHQ app.";
    listsContainer.append(empty);
    return;
  }
  for (const list of lists) {
    const label = document.createElement("label");
    label.className = "list-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = list.id;
    checkbox.addEventListener("change", updateAddButton);
    const name = document.createElement("span");
    name.textContent = list.name;
    label.append(checkbox, name);
    listsContainer.append(label);
  }
}

function updateAddButton() {
  const handle = handleInput.value.trim();
  const hasHandle = handle.length > 0;
  const checked = [...listsContainer.querySelectorAll<HTMLInputElement>("input:checked")];
  addBtn.disabled = !hasHandle;
  addBtn.textContent =
    checked.length === 0 ? "Add to CRM" : `Add to ${checked.length} list${checked.length === 1 ? "" : "s"}`;
}

function selectedListIds(): string[] {
  return [...listsContainer.querySelectorAll<HTMLInputElement>("input:checked")].map(
    (checkbox) => checkbox.value,
  );
}

function parseTags(): string[] {
  return tagsInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 32)
    .slice(0, 8);
}

function renderAppStatus(state: "connected" | "none" | "needsAuth" | "unreachable", profile: string | null) {
  switch (state) {
    case "connected":
      appText.textContent = profile ? `Connected · ${profile}` : "Connected";
      setDot(appDot, "ok");
      break;
    case "none":
      appText.textContent = "No connection";
      setDot(appDot, "bad");
      break;
    case "needsAuth":
      appText.textContent = "Log in to the app first";
      setDot(appDot, "bad");
      break;
    case "unreachable":
      appText.textContent = "Open the app in a tab";
      setDot(appDot, "bad");
      break;
  }
}

async function refreshStatus() {
  const status = await send({ type: "GET_STATUS" });
  if (!status.ok) return;

  flow = status.flow ?? { phase: "idle" };
  appPublicationUrl = status.appPublicationUrl ?? null;
  setDot(substackDot, status.substackLoggedIn ? "ok" : "bad");
  substackText.textContent = status.substackLoggedIn
    ? "Logged in"
    : "Not logged in";
  renderAppStatus(status.appState ?? "unreachable", status.appProfile ?? null);

  const profileResult = await send({ type: "GET_CURRENT_PROFILE" });
  profile = profileResult.profile ?? null;
  renderProfile();

  const listsResult = await send({ type: "FETCH_LISTS" });
  if (listsResult.ok) {
    lists = listsResult.lists ?? [];
  } else {
    lists = [];
    actionText.textContent = listsResult.message ?? "Could not load lists.";
    actionText.className = "hint warn";
    if (listsResult.needsAuth) {
      profileLine.textContent =
        "Log in to https://stackedhq.chillital.com first, then reopen this popup.";
      profileLine.className = "hint bad";
    } else if (listsResult.message?.includes("Open the StackedHQ app")) {
      profileLine.textContent = "Open https://stackedhq.chillital.com/app in a tab to enable adding people.";
    }
  }
  renderLists();
  renderFlow();
}

connectBtn.addEventListener("click", async () => {
  connectBtn.disabled = true;
  const result = await send({ type: "START_CONNECT_FLOW" });
  flow = result.flow ?? { phase: "idle" };
  renderFlow();
});

pubSubmitBtn.addEventListener("click", () => {
  const value = pubInput.value.trim();
  if (!validPublicationUrl(value)) {
    pubError.textContent = "Enter a valid https://…substack.com URL or skip.";
    pubError.classList.remove("hidden");
    return;
  }
  void submitPublicationUrl(value || null);
});

pubSkipBtn.addEventListener("click", () => {
  void submitPublicationUrl(null);
});

pubInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    pubSubmitBtn.click();
  }
});

addBtn.addEventListener("click", async () => {
  const name = profile?.name ?? handleInput.value.trim();
  const handle = handleInput.value.trim();
  if (!handle) return;
  addBtn.disabled = true;
  actionText.className = "hint warn";
  actionText.textContent = "Adding…";
  const result = await send({
    type: "ADD_TO_LISTS",
    name,
    handle,
    lists: selectedListIds(),
    tags: parseTags(),
  });
  actionText.textContent = result.message ?? (result.ok ? "Added." : "Failed.");
  actionText.className = `hint ${result.ok ? "ok" : "bad"}`;
  addBtn.disabled = false;
  updateAddButton();
});

handleInput.addEventListener("input", updateAddButton);

chrome.runtime.onMessage.addListener((message: { type?: string; flow?: FlowState }) => {
  if (message.type === "FLOW_CHANGED" && message.flow) {
    flow = message.flow;
    renderFlow();
    if (flow.phase === "done") void refreshStatus();
  }
});

void refreshStatus();
