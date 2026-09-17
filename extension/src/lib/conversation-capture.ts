export type CapturedReply = {
  id: string; body: string; createdAt: string | null; authorName: string | null;
  authorHandle: string | null; authorPhotoUrl: string | null; authorId: string | null;
  children: CapturedReply[];
};
export type CapturedConversation = {
  kind: "conversation"; targetType: "note" | "post"; targetId: string; sourceUrl: string;
  comments: CapturedReply[]; rootAuthor: CapturedReply | null; moreComments: number; nextCursor: string | null;
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number): string | null => typeof value === "string" && value.length <= max ? value : null;
const id = (value: unknown): string | null =>
  (typeof value === "string" && /^[0-9]+$/.test(value) && value.length <= 512) ||
  (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ? String(value) : null;
function safeUrl(value: unknown): string | null {
  try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function conversationTarget(url: string): { targetType: "note" | "post"; targetId: string; sourceUrl: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !(parsed.hostname === "substack.com" || parsed.hostname.endsWith(".substack.com"))) return null;
    const note = /^\/api\/v1\/reader\/comment\/(\d+)\/replies$/.exec(parsed.pathname);
    const post = /^\/api\/v1\/post\/(\d+)\/comments$/.exec(parsed.pathname);
    if (!note && !post) return null;
    return { targetType: note ? "note" : "post", targetId: (note ?? post)![1]!, sourceUrl: parsed.origin + parsed.pathname };
  } catch { return null; }
}

/** Allow-list content fields only. Fail explicitly rather than silently trimming a tree. */
export function normalizeConversationResponse(url: string, payload: unknown): CapturedConversation | null {
  const target = conversationTarget(url);
  const data = record(payload);
  if (!target || !data) return null;
  const branches = target.targetType === "note" ? data.commentBranches ?? data.comments : data.comments;
  if (!Array.isArray(branches)) return null;
  let count = 0;
  function reply(value: unknown, depth: number): CapturedReply {
    const branch = record(value);
    const comment = record(branch?.comment) ?? branch;
    if (!comment || !id(comment.id) || typeof comment.body !== "string") throw new Error("Unsupported conversation comment shape.");
    if (++count > 1000 || depth > 20 || comment.body.length > 100_000) throw new Error("Conversation exceeds capture safety limits; no partial tree was queued.");
    const user = record(comment.user) ?? record(comment.author) ?? record(branch?.user);
    const children = branch?.children ?? branch?.descendantComments ?? branch?.replies ?? [];
    if (!Array.isArray(children)) throw new Error("Invalid conversation children.");
    return {
      id: id(comment.id)!, body: comment.body,
      createdAt: text(comment.createdAt ?? comment.date ?? comment.created_at, 128),
      authorName: text(comment.authorName ?? comment.name ?? user?.name, 256),
      authorHandle: text(comment.authorHandle ?? comment.handle ?? user?.handle, 256),
      authorPhotoUrl: safeUrl(comment.authorPhotoUrl ?? comment.photo_url ?? comment.photoUrl ?? user?.photo_url ?? user?.photoUrl),
      authorId: id(comment.authorId ?? user?.id ?? comment.user_id),
      children: children.map((child) => reply(child, depth + 1)),
    };
  }
  const comments = branches.map((branch) => reply(branch, 0));
  let rootAuthor: CapturedReply | null = null;
  const root = record(data.rootComment ?? data.rootAuthor);
  // Root Note is context, not a comment interaction. It may be only an ID.
  if (root && typeof root.body === "string") rootAuthor = reply({ ...root, children: [] }, 0);
  const more = data.moreBranches ?? data.moreComments ?? 0;
  if (typeof more !== "number" || !Number.isSafeInteger(more) || more < 0) throw new Error("Invalid conversation pagination.");
  return { kind: "conversation", ...target, comments, rootAuthor, moreComments: more, nextCursor: text(data.nextCursor, 2048) };
}

export function validateCapturedConversation(value: unknown): CapturedConversation {
  const data = record(value);
  if (data?.kind !== "conversation" || typeof data.sourceUrl !== "string") throw new Error("Invalid conversation capture.");
  const normalized = normalizeConversationResponse(data.sourceUrl, data);
  if (!normalized || normalized.targetId !== data.targetId || normalized.targetType !== data.targetType) throw new Error("Invalid conversation target.");
  return normalized;
}
