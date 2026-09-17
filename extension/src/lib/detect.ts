import type { DetectedProfile } from "./types";

export function detectProfileFromTab(tab: chrome.tabs.Tab): DetectedProfile | null {
  const url = tab.url ?? "";
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  })();

  const handleMatch = pathname.match(
    /^\/(?:@([^/?#]+)|profile\/\d+-([^/?#]+))(?:\/.*)?$/,
  );
  const handle = handleMatch?.[1] ?? handleMatch?.[2];
  if (!handle) return null;

  let name: string | null = null;
  const title = (tab.title ?? "").replace(/\s*-\s*Substack\s*$/i, "").trim();
  if (title && !title.includes("@") && title.length <= 80) {
    name = title;
  }

  return { handle: handle.toLocaleLowerCase("en"), name, pageUrl: url };
}
