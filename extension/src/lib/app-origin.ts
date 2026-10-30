const STORAGE_KEY = "appOrigin";
const APP_SCRIPT_ID = "circles-app-bridge";

/**
 * Returns the origin of a Circles server URL the user typed, or null when it is
 * not one the extension may talk to: https anywhere, plain http only locally.
 */
export function normalizeAppOrigin(input: string): string | null {
  try {
    const url = new URL(input.trim().includes("://") ? input.trim() : `https://${input.trim()}`);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/** The Circles server this browser is paired with, or null until the user pairs one in the side panel. */
export async function getAppOrigin(): Promise<string | null> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  return typeof stored === "string" && normalizeAppOrigin(stored) === stored ? stored : null;
}

export async function isAppOriginUrl(url: string | undefined): Promise<boolean> {
  try {
    const origin = await getAppOrigin();
    return !!url && !!origin && new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export const originPattern = (origin: string) => `${origin}/*`;

/** The paired origin when Chrome still grants access to it; null means the user must (re)pair. */
export async function grantedAppOrigin(): Promise<string | null> {
  const origin = await getAppOrigin();
  return origin && (await chrome.permissions.contains({ origins: [originPattern(origin)] })) ? origin : null;
}

/** Registers the app bridge content script for the paired origin, when Chrome has granted access to it. */
export async function syncAppContentScript(): Promise<boolean> {
  const origin = await grantedAppOrigin();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [APP_SCRIPT_ID] });
  if (!origin) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [APP_SCRIPT_ID] });
    return false;
  }
  const script = { id: APP_SCRIPT_ID, matches: [originPattern(origin)], js: ["content.js"], runAt: "document_idle" as const };
  await (existing.length ? chrome.scripting.updateContentScripts([script]) : chrome.scripting.registerContentScripts([script]));
  return true;
}

/**
 * Pairs the extension with a Circles server. Call from a click handler: the
 * permission prompt needs the user gesture, so it runs before anything awaits.
 */
export async function pairAppOrigin(origin: string): Promise<boolean> {
  const granted = await chrome.permissions.request({ origins: [originPattern(origin)] });
  return granted && setAppOrigin(origin);
}

export async function setAppOrigin(origin: string): Promise<boolean> {
  await chrome.storage.local.set({ [STORAGE_KEY]: origin });
  return syncAppContentScript();
}

/** The Circles origin behind a newly granted host permission, if it is one. */
export function originFromPattern(pattern: string): string | null {
  const origin = pattern.replace(/\/\*$/, "");
  return origin.includes("*") ? null : normalizeAppOrigin(origin);
}

export const APP_ORIGIN_STORAGE_KEY = STORAGE_KEY;
