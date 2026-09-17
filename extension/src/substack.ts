const ADD_BTN_MARKER = "data-stackedhq-crm";

const USER_PLUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

const STYLES = `
.stackedhq-add-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;font-size:12px;font-weight:600;line-height:1;color:#fff;background:#0d9488;border:1px solid rgba(255,255,255,.2);border-radius:999px;cursor:pointer;white-space:nowrap;transition:all .15s ease;vertical-align:middle;box-sizing:border-box;}
.stackedhq-add-btn:hover{background:#0f766e;color:#fff;}
.stackedhq-add-btn:disabled{opacity:.65;cursor:default;}
.stackedhq-add-btn.done{background:#059669;border-color:rgba(255,255,255,.25);cursor:pointer;}
.stackedhq-add-btn.done:hover{background:#047857;}
.stackedhq-add-btn.error{background:#dc2626;border-color:rgba(255,255,255,.2);}
.stackedhq-modal-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);}
.stackedhq-modal{width:320px;max-width:calc(100vw - 32px);background:#fff;color:#191919;border-radius:12px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:system-ui,-apple-system,sans-serif;}
.stackedhq-modal-title{margin:0 0 4px;font-size:14px;font-weight:600;}
.stackedhq-modal-sub{margin:0 0 12px;font-size:12px;color:#6b7280;}
.stackedhq-modal-lists{display:grid;gap:4px;max-height:180px;overflow-y:auto;margin-bottom:12px;}
.stackedhq-modal-list{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;cursor:pointer;}
.stackedhq-modal-list input{accent-color:#0d9488;margin:0;}
.stackedhq-modal-list.empty{justify-content:center;color:#6b7280;border-style:dashed;cursor:default;}
.stackedhq-modal-error{margin:0 0 8px;font-size:12px;color:#dc2626;}
.stackedhq-modal-actions{display:flex;justify-content:flex-end;gap:8px;}
.stackedhq-modal-btn{border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;}
.stackedhq-modal-cancel{background:#f3f4f6;color:#374151;}
.stackedhq-modal-cancel:hover{background:#e5e7eb;}
.stackedhq-modal-add{background:#0d9488;color:#fff;}
.stackedhq-modal-add:hover{background:#0f766e;}
.stackedhq-modal-add:disabled{opacity:.6;cursor:default;}
`;

function injectStyles() {
  if (document.getElementById("stackedhq-add-styles")) return;
  const style = document.createElement("style");
  style.id = "stackedhq-add-styles";
  style.textContent = STYLES;
  (document.head ?? document.documentElement).append(style);
}

function parseAuthorLink(href: string): string | null {
  const match = href.match(/(?:substack\.com\/@|\/@|^@?)([a-zA-Z0-9_-]+)/);
  return match?.[1] ? match[1].toLocaleLowerCase("en") : null;
}

function authorInfoFromElement(container: Element): { handle: string; name: string } | null {
  const links = [
    ...container.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/@"], a[href^="/@"], a[href^="https://substack.com/@"]',
    ),
  ];
  if (links.length === 0) return null;

  const avatar = links.find((link) => link.querySelector("img") !== null);
  const named = links.find((link) => (link.textContent ?? "").trim().length > 0);
  const targetLink = avatar ?? named ?? links[0];
  const href = targetLink?.getAttribute("href") ?? "";
  const handle = parseAuthorLink(href);
  if (!handle) return null;

  const rawName = (named?.textContent ?? "").trim();
  const titleAttr = container.querySelector<HTMLElement>("[title]")?.getAttribute("title")?.trim();
  const name = (rawName && !rawName.startsWith("@") ? rawName : titleAttr) || handle;

  return { handle, name };
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
  if (icon) {
    button.innerHTML = `${icon}${escapeHtml(text)}`;
  } else {
    button.textContent = text;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      `%c[StackedHQ Companion] Recognized CRM contact: @${handle}`,
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
          ? "Log in to StackedHQ first, then try again."
          : record.message ?? "Could not load your lists. Open StackedHQ and try again.",
      };
    }
  } catch {
    // fall through to a generic error
  }
  return { lists: [], error: "Could not reach StackedHQ. Open the app and try again." };
}

function closeListModal() {
  document.querySelector(".stackedhq-modal-overlay")?.remove();
}

function openListModal(
  button: HTMLButtonElement,
  info: { handle: string; name: string },
  lists: { id: string; name: string }[],
  error: string | null,
) {
  closeListModal();

  const overlay = document.createElement("div");
  overlay.className = "stackedhq-modal-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeListModal();
  });

  const modal = document.createElement("div");
  modal.className = "stackedhq-modal";

  const title = document.createElement("p");
  title.className = "stackedhq-modal-title";
  title.textContent = `Add @${info.handle} to lists`;

  const sub = document.createElement("p");
  sub.className = "stackedhq-modal-sub";
  sub.textContent =
    info.name && info.name !== info.handle
      ? info.name
      : "Select one or more lists for this contact.";

  const listsBox = document.createElement("div");
  listsBox.className = "stackedhq-modal-lists";

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
    empty.className = "stackedhq-modal-list empty";
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
      label.className = "stackedhq-modal-list";
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
  errorEl.className = "stackedhq-modal-error";
  if (error) {
    errorEl.textContent = error;
  } else {
    errorEl.style.display = "none";
  }

  const actions = document.createElement("div");
  actions.className = "stackedhq-modal-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "stackedhq-modal-btn stackedhq-modal-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeListModal);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "stackedhq-modal-btn stackedhq-modal-add";
  add.textContent = lists.length === 0 ? "Add contact" : "Save to lists";
  add.disabled = Boolean(error);
  add.addEventListener("click", async () => {
    const selected = [
      ...listsBox.querySelectorAll<HTMLInputElement>("input:checked"),
    ].map((checkbox) => checkbox.value);
    closeListModal();
    await submitAdd(button, info, selected);
  });

  actions.append(cancel, add);
  modal.append(title, sub, listsBox, errorEl, actions);
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
      `%c[StackedHQ Companion] ✅ Added @${info.handle} (${info.name}) to CRM:`,
      "color: #10b981; font-weight: bold;",
      memberLists,
    );
    return;
  }

  const message = response?.message ?? "Could not add. Open StackedHQ first.";
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
  const info = authorInfoFromElement(note);
  if (!moreOptions || !info) return;

  const moreContainer = moreOptions.parentElement;
  const row = moreContainer?.parentElement;
  if (!row || !moreContainer) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "stackedhq-add-btn";
  button.setAttribute(ADD_BTN_MARKER, "true");
  button.innerHTML = `${USER_PLUS_ICON}Add to list`;
  button.addEventListener("click", () => addPerson(button, info));

  row.insertBefore(button, moreContainer);
  void checkCrmStatus(button, info.handle);
}

function processSavedOrFeedPost(card: Element) {
  if (card.querySelector(`[${ADD_BTN_MARKER}]`)) return;

  const info = authorInfoFromElement(card);
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
  button.className = "stackedhq-add-btn";
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
  button.className = "stackedhq-add-btn";
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
  button.className = "stackedhq-add-btn";
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
  `%c[StackedHQ Companion] Active on Substack (%c${window.location.pathname}%c)`,
  "color: #0d9488; font-weight: bold;",
  "color: #0284c7;",
  "color: #0d9488; font-weight: bold;",
);

injectStyles();
processNotes();
processPosts();
processProfilePage();
processSinglePostPage();
observePage();
