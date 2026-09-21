export function parseAuthorLink(href: string): string | null {
  if (!href) return null;
  // Match substack.com/@handle, /@handle, or bare @handle (not bare words or general paths)
  const match = href.match(/(?:substack\.com\/@|\/@|^@)([a-zA-Z0-9_-]+)/i);
  if (!match?.[1]) return null;
  const handle = match[1].toLocaleLowerCase("en");
  const reserved = new Set([
    "home",
    "notes",
    "inbox",
    "activity",
    "explore",
    "search",
    "settings",
    "publish",
    "https",
    "http",
    "api",
    "p",
    "post",
  ]);
  return reserved.has(handle) ? null : handle;
}

export interface AuthorInfo {
  handle: string;
  name: string;
}

interface Candidate {
  handle: string;
  names: string[];
  hasAvatar: boolean;
  isRestacker: boolean;
}

export function authorInfoFromElement(container: Element): AuthorInfo | null {
  const links = [
    ...container.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/@"], a[href^="/@"], a[href^="https://substack.com/@"]',
    ),
  ];
  if (links.length === 0) return null;

  const candidates = new Map<string, Candidate>();

  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const handle = parseAuthorLink(href);
    if (!handle) continue;

    let candidate = candidates.get(handle);
    if (!candidate) {
      candidate = {
        handle,
        names: [],
        hasAvatar: false,
        isRestacker: false,
      };
      candidates.set(handle, candidate);
    }

    const img = link.querySelector("img");
    if (img !== null) {
      candidate.hasAvatar = true;
      const imgAlt = img.getAttribute("alt")?.trim();
      if (
        imgAlt &&
        !imgAlt.startsWith("@") &&
        !imgAlt.toLowerCase().includes("restacked")
      ) {
        candidate.names.push(imgAlt);
      }
    }

    // Check if this link is inside a restack header/banner
    const parentText = (link.parentElement?.textContent ?? "").toLowerCase();
    const linkText = (link.textContent ?? "").trim();
    if (
      parentText.includes("restacked") &&
      !link.querySelector("img") &&
      !parentText.includes("restacked with")
    ) {
      candidate.isRestacker = true;
    }

    const cleanName = linkText.replace(/\s+/g, " ");
    if (
      cleanName &&
      !cleanName.startsWith("@") &&
      !cleanName.toLowerCase().includes("restacked")
    ) {
      candidate.names.push(cleanName);
    }

    const titleAttr = link.getAttribute("title")?.trim();
    if (
      titleAttr &&
      !titleAttr.startsWith("@") &&
      !titleAttr.toLowerCase().includes("restacked")
    ) {
      candidate.names.push(titleAttr);
    }
  }

  if (candidates.size === 0) return null;

  // Score candidates
  const scored = [...candidates.values()].map((c) => {
    let score = 0;
    if (c.hasAvatar) score += 30;
    if (c.names.length > 0) score += 20;
    if (c.hasAvatar && c.names.length > 0) score += 30; // Both avatar & display name present for same handle
    if (c.isRestacker) score -= 100; // Penalize banner restacker header
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  // Invariant: The display name is strictly resolved from this chosen candidate's own links/attributes.
  // Handles and names from different authors are never cross-wired.
  const name = best.names[0] || best.handle;

  return { handle: best.handle, name };
}
