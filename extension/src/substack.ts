import { authorInfoFromElement, parseAuthorLink } from "./lib/author-parser";

const ADD_BTN_MARKER = "data-circles-crm";

const USER_PLUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

const STYLES = `
.circles-add-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;font-size:12px;font-weight:600;line-height:1;color:#fff;background:#ea580c;border:1px solid rgba(255,255,255,.2);border-radius:999px;cursor:pointer;white-space:nowrap;transition:all .15s ease;vertical-align:middle;box-sizing:border-box;}
.circles-add-btn:hover{background:#c2410c;color:#fff;}
.circles-add-btn:disabled{opacity:.65;cursor:default;}
.circles-add-btn.done{background:#059669;border-color:rgba(255,255,255,.25);cursor:pointer;}
.circles-add-btn.done:hover{background:#047857;}
.circles-add-btn.error{background:#dc2626;border-color:rgba(255,255,255,.2);}
.circles-modal-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);}
.circles-modal{width:320px;max-width:calc(100vw - 32px);background:#18181b;color:#f4f4f5;border:1px solid #27272a;border-radius:12px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-family:system-ui,-apple-system,sans-serif;}
.circles-modal-title{margin:0 0 4px;font-size:14px;font-weight:600;color:#f4f4f5;}
.circles-modal-sub{margin:0 0 12px;font-size:12px;color:#a1a1aa;}
.circles-modal-profile{display:block;margin:0 0 12px;font-size:12px;color:#fb923c;text-decoration:underline;text-underline-offset:2px;}
.circles-modal-confirm{display:flex;align-items:flex-start;gap:8px;margin:0 0 12px;font-size:12px;color:#d4d4d8;cursor:pointer;}
.circles-modal-confirm input{margin-top:2px;accent-color:#ea580c;}
.circles-modal-lists{display:grid;gap:5px;max-height:180px;overflow-y:auto;margin-bottom:12px;}
.circles-modal-list{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#09090b;border:1px solid #27272a;border-radius:8px;font-size:13px;cursor:pointer;color:#f4f4f5;}
.circles-modal-list:hover{background:#27272a;}
.circles-modal-list input{accent-color:#ea580c;margin:0;}
.circles-modal-list.empty{justify-content:center;color:#71717a;border-style:dashed;cursor:default;}
.circles-modal-error{margin:0 0 8px;font-size:12px;color:#f43f5e;}
.circles-modal-actions{display:flex;justify-content:flex-end;gap:8px;}
.circles-modal-btn{border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;}
.circles-modal-cancel{background:#27272a;color:#d4d4d8;}
.circles-modal-cancel:hover{background:#3f3f46;}
.circles-modal-add{background:#ea580c;color:#fff;}
.circles-modal-add:hover{background:#c2410c;}
.circles-modal-add:disabled{opacity:.5;cursor:default;}
`;

function injectStyles() {
  if (document.getElementById("circles-add-styles")) return;
  const style = document.createElement("style");
  style.id = "circles-add-styles";
  style.textContent = STYLES;
  (document.head ?? document.documentElement).append(style);
}


function setButtonState(
  button: HTMLButtonElement,
  state: "default" | "busy" | "done" | "error",
  text: string,
  icon?: string,
) {
  button.classList.toggle("done", state === "done");
  button.classList.toggle("error", state === "error");
  button.disabled = state === "busy";
  button.innerHTML = icon ?? "";
  button.append(text);
}

function formatListLabel(lists: Array<{ id: string; name: string }>): string {
  if (lists.length === 0) return "In CRM";
  const first = lists[0];
  if (!first) return "In CRM";
  if (lists.length === 1) return first.name;
  return `${first.name} +${lists.length - 1}`;
}

async function checkCrmStatus(button: HTMLButtonElement, handle: string) {
  let response:
    | { inCrm?: boolean; memberLists?: Array<{ id: string; name: string }> }
    | undefined;
  try {
    response = await chrome.runtime.sendMessage({
      type: "GET_CRM_STATUS",
      handle,
    });
  } catch {
    return;
  }
  if (response?.inCrm && !button.dataset.engaged) {
    const lists = response.memberLists ?? [];
    button.dataset.memberLists = JSON.stringify(lists);
    const label = formatListLabel(lists);
    setButtonState(button, "done", label, CHECK_ICON);
    button.title = lists.length > 0
      ? `On list(s): ${lists.map((l) => l.name).join(", ")}. Click to manage.`
      : "In Community. Click to add to lists.";
    console.log(
      `%c[Circles Companion] Recognized CRM contact: @${handle}`,
      "color: #10b981; font-weight: bold;",
      lists,
    );
  }
}

let cachedLists: { id: string; name: string }[] | null = null;

type ListsResult = { lists: { id: string; name: string }[]; error: string | null };

async function getLists(): Promise<ListsResult> {
  if (cachedLists) return { lists: cachedLists, error: null };
  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_LISTS" });
    const record = response as
      | { ok?: boolean; needsAuth?: boolean; message?: string; lists?: { id: string; name: string }[] }
      | undefined;
    if (record?.ok && Array.isArray(record.lists)) {
      cachedLists = record.lists;
      return { lists: record.lists, error: null };
    }
    if (record && !record.ok) {
      return {
        lists: [],
        error: record.needsAuth
          ? "Log in to Circles first, then try again."
          : record.message ?? "Could not load your lists. Open Circles and try again.",
      };
    }
  } catch {
    // fall through to a generic error
  }
  return { lists: [], error: "Could not reach Circles. Open the app and try again." };
}

function closeListModal() {
  document.querySelector(".circles-modal-overlay")?.remove();
}

function openListModal(
  button: HTMLButtonElement,
  info: { handle: string; name: string },
  lists: { id: string; name: string }[],
  error: string | null,
) {
  closeListModal();

  const overlay = document.createElement("div");
  overlay.className = "circles-modal-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeListModal();
  });

  const modal = document.createElement("div");
  modal.className = "circles-modal";

  const title = document.createElement("p");
  title.className = "circles-modal-title";
  title.textContent = `Add @${info.handle} to lists`;

  const sub = document.createElement("p");
  sub.className = "circles-modal-sub";
  sub.textContent = `Check that ${info.name} is the person at this Substack profile before saving.`;

  const profileLink = document.createElement("a");
  profileLink.className = "circles-modal-profile";
  profileLink.href = `https://substack.com/@${encodeURIComponent(info.handle)}`;
  profileLink.target = "_blank";
  profileLink.rel = "noopener noreferrer";
  profileLink.textContent = `Open @${info.handle} on Substack ↗`;

  const confirmation = document.createElement("label");
  confirmation.className = "circles-modal-confirm";
  const confirmed = document.createElement("input");
  confirmed.type = "checkbox";
  const confirmationText = document.createElement("span");
  confirmationText.textContent = "The profile matches this person";
  confirmation.append(confirmed, confirmationText);

  const listsBox = document.createElement("div");
  listsBox.className = "circles-modal-lists";

  let assignedListIds = new Set<string>();
  if (button.dataset.memberLists) {
    try {
      const existing = JSON.parse(button.dataset.memberLists) as Array<{ id: string }>;
      assignedListIds = new Set(existing.map((item) => item.id));
    } catch {
      // ignore
    }
  }

  if (error) {
    listsBox.style.display = "none";
  } else if (lists.length === 0) {
    const empty = document.createElement("div");
    empty.className = "circles-modal-list empty";
    empty.textContent = "No lists yet — you can add without one.";
    listsBox.append(empty);
  } else {
    const limitListSelection = () => {
      const checked = [...listsBox.querySelectorAll<HTMLInputElement>("input:checked")].length;
      for (const checkbox of listsBox.querySelectorAll<HTMLInputElement>("input")) {
        checkbox.disabled = !checkbox.checked && checked >= 20;
      }
    };
    for (const list of lists) {
      const label = document.createElement("label");
      label.className = "circles-modal-list";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = list.id;
      checkbox.checked = assignedListIds.has(list.id);
      checkbox.addEventListener("change", limitListSelection);
      const name = document.createElement("span");
      name.textContent = list.name;
      label.append(checkbox, name);
      listsBox.append(label);
    }
  }

  const errorEl = document.createElement("p");
  errorEl.className = "circles-modal-error";
  if (error) {
    errorEl.textContent = error;
  } else {
    errorEl.style.display = "none";
  }

  const actions = document.createElement("div");
  actions.className = "circles-modal-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "circles-modal-btn circles-modal-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeListModal);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "circles-modal-btn circles-modal-add";
  add.textContent = lists.length === 0 ? "Add contact" : "Save to lists";
  add.disabled = true;
  confirmed.addEventListener("change", () => {
    add.disabled = Boolean(error) || !confirmed.checked;
  });
  add.addEventListener("click", async () => {
    const selected = [
      ...listsBox.querySelectorAll<HTMLInputElement>("input:checked"),
    ].map((checkbox) => checkbox.value);
    closeListModal();
    await submitAdd(button, info, selected);
  });

  actions.append(cancel, add);
  modal.append(title, sub, profileLink, confirmation, listsBox, errorEl, actions);
  overlay.append(modal);
  document.body.append(overlay);
}

async function submitAdd(
  button: HTMLButtonElement,
  info: { handle: string; name: string },
  lists: string[],
) {
  setButtonState(button, "busy", "Saving…");
  let response:
    | {
        ok?: boolean;
        message?: string;
        alreadyInCrm?: boolean;
        memberLists?: Array<{ id: string; name: string }>;
      }
    | undefined;
  try {
    response = await chrome.runtime.sendMessage({
      type: "ADD_FEED_PERSON",
      handle: info.handle,
      name: info.name,
      lists,
    });
  } catch {
    response = undefined;
  }

  if (response?.ok || response?.alreadyInCrm) {
    const memberLists = response.memberLists ?? [];
    button.dataset.memberLists = JSON.stringify(memberLists);
    const label = formatListLabel(memberLists);
    setButtonState(button, "done", label, CHECK_ICON);
    button.title = memberLists.length > 0
      ? `On list(s): ${memberLists.map((l) => l.name).join(", ")}. Click to manage.`
      : "In Community. Click to add to lists.";
    console.log(
      `%c[Circles Companion] ✅ Added @${info.handle} (${info.name}) to CRM:`,
      "color: #10b981; font-weight: bold;",
      memberLists,
    );
    return;
  }

  const message = response?.message ?? "Could not add. Open Circles first.";
  button.title = message;
  setButtonState(button, "error", "Failed");
  setTimeout(() => {
    if (!button.classList.contains("done")) {
      button.classList.remove("error");
      button.dataset.engaged = "";
      button.disabled = false;
      button.innerHTML = `${USER_PLUS_ICON}Add to list`;
      button.title = "";
    }
  }, 2_500);
}

async function addPerson(button: HTMLButtonElement, info: { handle: string; name: string }) {
  const { lists, error } = await getLists();
  openListModal(button, info, lists, error);
}

function processNote(note: Element) {
  if (note.querySelector(`[${ADD_BTN_MARKER}]`)) return;

  const moreOptions = note.querySelector<HTMLButtonElement>('button[aria-label="More options"]');
  if (!moreOptions) return;

  const moreContainer = moreOptions.parentElement;
  const row = moreContainer?.parentElement;
  if (!row || !moreContainer) return;

  const info = authorInfoFromElement(row) ?? authorInfoFromElement(note);
  if (!info) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "circles-add-btn";
  button.setAttribute(ADD_BTN_MARKER, "true");
  button.innerHTML = `${USER_PLUS_ICON}Add to list`;
  button.addEventListener("click", () => addPerson(button, info));

  row.insertBefore(button, moreContainer);
  void checkCrmStatus(button, info.handle);
}

function processSavedOrFeedPost(card: Element) {
  if (card.querySelector(`[${ADD_BTN_MARKER}]`)) return;

  const byline =
    card.querySelector('[class*="byline"]') ??
    card.querySelector('[class*="post-header"]') ??
    card.querySelector("header");

  const info = (byline ? authorInfoFromElement(byline) : null) ?? authorInfoFromElement(card);
  if (!info) return;

  const targetContainer =
    card.querySelector(".post-preview-actions") ??
    card.querySelector('[class*="actions"]') ??
    card.querySelector('[class*="byline"]') ??
    card.querySelector('button[aria-label="Bookmark"]')?.parentElement ??
    card.querySelector('button[aria-label="More options"]')?.parentElement ??
    card.querySelector("footer") ??
    card;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "circles-add-btn";
  button.setAttribute(ADD_BTN_MARKER, "post");
  button.style.margin = "4px 6px";
  button.innerHTML = `${USER_PLUS_ICON}Add to list`;
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    void addPerson(button, info);
  });

  if (targetContainer !== card && targetContainer.firstChild) {
    targetContainer.insertBefore(button, targetContainer.firstChild);
  } else {
    targetContainer.append(button);
  }

  void checkCrmStatus(button, info.handle);
}

function processNotes() {
  for (const note of document.querySelectorAll('[role="article"][aria-label="Note"]')) {
    processNote(note);
  }
}

function processPosts() {
  const postSelectors = [
    ".post-preview",
    '[data-testid="post-preview"]',
    "article.reader-post-card",
    'article:not([aria-label="Note"])',
    '[class*="saved-post-item"]',
    '[class*="saved-item"]',
    '.reader-item',
  ];

  for (const selector of postSelectors) {
    for (const el of document.querySelectorAll(selector)) {
      processSavedOrFeedPost(el);
    }
  }
}

function profilePageInfo(): { handle: string; name: string } | null {
  const path = window.location.pathname;
  const match = path.match(/^\/(?:@([^/?#]+)|profile\/\d+-([^/?#]+))/);
  const handle = match?.[1] ?? match?.[2];
  if (!handle) return null;
  const heading = document.querySelector<HTMLElement>("h1");
  const name = (heading?.textContent ?? "").trim() || handle;
  return { handle: handle.toLocaleLowerCase("en"), name: name.slice(0, 80) };
}

function processProfilePage() {
  const info = profilePageInfo();
  if (!info) return;

  const heading = document.querySelector<HTMLElement>("h1");
  if (!heading) return;

  const existing = document.querySelector<HTMLButtonElement>(
    `[${ADD_BTN_MARKER}="profile"]`,
  );
  if (existing) {
    if (existing.dataset.handle === info.handle) return;
    existing.remove();
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "circles-add-btn";
  button.style.marginLeft = "12px";
  button.setAttribute(ADD_BTN_MARKER, "profile");
  button.dataset.handle = info.handle;
  button.innerHTML = `${USER_PLUS_ICON}Add to list`;
  button.addEventListener("click", () => addPerson(button, info));

  heading.insertAdjacentElement("afterend", button);
  void checkCrmStatus(button, info.handle);
}

function processSinglePostPage() {
  if (!window.location.pathname.includes("/p/")) return;
  const existing = document.querySelector<HTMLButtonElement>(`[${ADD_BTN_MARKER}="article-header"]`);
  if (existing) return;

  const byline =
    document.querySelector('[class*="byline"]') ??
    document.querySelector('[class*="post-header"]') ??
    document.querySelector("header");
  if (!byline) return;

  const info = authorInfoFromElement(byline);
  if (!info) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "circles-add-btn";
  button.setAttribute(ADD_BTN_MARKER, "article-header");
  button.style.marginLeft = "10px";
  button.innerHTML = `${USER_PLUS_ICON}Add to list`;
  button.addEventListener("click", () => addPerson(button, info));

  byline.append(button);
  void checkCrmStatus(button, info.handle);
}

function observePage() {
  const observer = new MutationObserver(() => {
    processNotes();
    processPosts();
    if (profilePageInfo()) processProfilePage();
    processSinglePostPage();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

console.log(
  `%c[Circles Companion] Active on Substack (%c${window.location.pathname}%c)`,
  "color: #ea580c; font-weight: bold;",
  "color: #0284c7;",
  "color: #ea580c; font-weight: bold;",
);

// The side panel's Settings can turn the in-page buttons off.
void chrome.storage.sync.get("inPageButtons").then((stored) => {
  if (stored.inPageButtons === false) return;
  injectStyles();
  processNotes();
  processPosts();
  processProfilePage();
  processSinglePostPage();
  observePage();
});
