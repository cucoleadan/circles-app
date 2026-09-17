import { SUBSTACK_SESSION_COOKIE } from "./constants";

function isSubstackCookie(cookie: chrome.cookies.Cookie): boolean {
  const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  return host === "substack.com" || host.endsWith(".substack.com");
}

function substackCookies(): Promise<chrome.cookies.Cookie[]> {
  return chrome.cookies.getAll({}).then((all) => all.filter(isSubstackCookie));
}

export async function getSubstackSessionValue(): Promise<string | null> {
  const cookies = await substackCookies();
  const sid = cookies.find((cookie) => cookie.name === SUBSTACK_SESSION_COOKIE);
  return sid && sid.value.length > 0 ? sid.value : null;
}

export async function hasSubstackSession(): Promise<boolean> {
  return (await getSubstackSessionValue()) !== null;
}
