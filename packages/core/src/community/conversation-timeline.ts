import type { CommunityInteraction } from "./types";

export type TimelineGroup = { id: string; items: CommunityInteraction[]; title: string; url: string | null; latestAt: string };
export function timelineLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname === "substack.com" || url.hostname.endsWith(".substack.com")) &&
      !url.pathname.startsWith("/api/") ? url.href : null;
  } catch { return null; }
}
const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

/** Groups captured context only; it does not infer unanswered status or relationship health. */
export function buildConversationTimeline(interactions: CommunityInteraction[]): TimelineGroup[] {
  const byComment = new Map(interactions.filter((item) => item.externalId.startsWith("comment:")).map((item) => [item.externalId.slice(8), item]));
  const roots = new Map([...byComment].filter(([, item]) => item.threadRootId).map(([id, item]) => [id, item.threadRootId!]));
  for (const item of interactions) if (item.threadRootId && item.targetType === "comment" && item.targetId && !roots.has(item.targetId)) roots.set(item.targetId, item.threadRootId);
  function key(item: CommunityInteraction, seen = new Set<string>()): string {
    if (item.threadRootId) return `thread:${item.threadRootId}`;
    const knownRoot = roots.get(item.externalId.slice(8));
    if (item.externalId.startsWith("comment:") && knownRoot) return `thread:${knownRoot}`;
    if (seen.has(item.id)) return `interaction:${item.id}`;
    seen.add(item.id);
    if (item.targetType === "comment" && item.targetId) {
      const parent = byComment.get(item.targetId);
      if (parent && parent.id !== item.id) return key(parent, seen);
      return `parent:${item.targetId}`;
    }
    if (item.targetId && (item.targetType === "note" || item.targetType === "post")) {
      return `thread:${item.targetType === "post" ? "post:" : ""}${item.targetId}`;
    }
    return `interaction:${item.id}`;
  }
  const groups = new Map<string, CommunityInteraction[]>();
  for (const item of interactions) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return [...groups].map(([id, items]) => {
    items.sort((a, b) => timestamp(a.occurredAt) - timestamp(b.occurredAt) || a.id.localeCompare(b.id));
    const title = items.find((item) => item.targetTitle)?.targetTitle ??
      (items.some((item) => item.actionType === "comment" || item.actionType === "reply") ? "Conversation" : "Interaction");
    const url = items.map((item) => timelineLink(item.targetUrl) ?? timelineLink(item.metadata?.url)).find(Boolean) ?? null;
    return { id, items, title, url, latestAt: items.at(-1)!.occurredAt };
  }).sort((a, b) => timestamp(b.latestAt) - timestamp(a.latestAt) || a.id.localeCompare(b.id));
}

export function timelineDate(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
