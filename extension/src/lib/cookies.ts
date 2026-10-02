import { SUBSTACK_SESSION_COOKIE } from "./constants";

export async function getSubstackSessionValue(): Promise<string | null> {
  // The domain filter matches substack.com and its subdomains.
  const cookies = await chrome.cookies.getAll({ domain: "substack.com", name: SUBSTACK_SESSION_COOKIE });
  return cookies.find((cookie) => cookie.value.length > 0)?.value ?? null;
}

export async function hasSubstackSession(): Promise<boolean> {
  return (await getSubstackSessionValue()) !== null;
}
