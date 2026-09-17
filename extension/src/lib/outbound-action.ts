export type CapturedOutboundAction = {
  kind: "outbound-action";
  action: "like" | "restack" | "comment" | "reply";
  active: boolean;
  externalId: string;
  occurredAt: string;
  targetKind: "note" | "post" | "comment";
  targetId: string;
  targetUrl: string;
  targetAuthor: { handle: string; name: string | null } | null;
  body: string | null;
};

const record = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;

function requestBody(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value)) ?? {};
    } catch {
      return Object.fromEntries(new URLSearchParams(value));
    }
  }
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return Object.fromEntries(value.entries());
  }
  return record(value) ?? {};
}

function responseId(value: unknown): string | null {
  const data = record(value);
  const candidate = data?.id ?? data?.comment?.id ?? data?.item?.comment?.id;
  return typeof candidate === "number" || (typeof candidate === "string" && candidate)
    ? String(candidate)
    : null;
}

function textFromBodyJson(value: unknown): string | null {
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const item = record(node);
    if (!item) return;
    if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
    visit(item.content);
  };
  visit(value);
  const result = texts.join(" ").trim();
  return result || null;
}

function pageAuthor(pageUrl: string): { handle: string; name: null } | null {
  try {
    const match = /^\/@([^/]+)/.exec(new URL(pageUrl).pathname);
    return match?.[1] ? { handle: decodeURIComponent(match[1]), name: null } : null;
  } catch {
    return null;
  }
}

function responseAuthor(value: unknown): { handle: string; name: string | null } | null {
  const data = record(value);
  if (!data) return null;
  const candidates = [
    data.user,
    data.author,
    record(data.comment)?.user,
    record(data.comment)?.author,
    record(record(data.item)?.comment)?.user,
    record(data.post)?.user,
    record(data.post)?.author,
  ];
  for (const candidate of candidates) {
    const person = record(candidate);
    const handle = person?.handle ?? person?.username;
    if (typeof handle === "string" && handle.trim()) {
      return {
        handle: handle.trim().replace(/^@/, ""),
        name: typeof person?.name === "string" ? person.name : null,
      };
    }
  }
  return null;
}

export function captureOutboundAction(input: {
  requestUrl: string;
  method: string;
  body?: unknown;
  response?: unknown;
  pageUrl: string;
  occurredAt?: string;
}): CapturedOutboundAction | null {
  let request: URL;
  try {
    request = new URL(input.requestUrl, input.pageUrl);
  } catch {
    return null;
  }
  if (
    request.protocol !== "https:" ||
    !(request.hostname === "substack.com" || request.hostname.endsWith(".substack.com"))
  ) return null;

  const method = input.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const data = requestBody(input.body);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const targetAuthor = responseAuthor(input.response) ?? pageAuthor(input.pageUrl);
  const targetUrl = input.pageUrl;

  const reaction = /^\/api\/v1\/(comment|post)\/(\d+)\/reaction$/.exec(request.pathname);
  if (reaction) {
    const targetKind = reaction[1] === "post" ? "post" : "comment";
    const targetId = reaction[2]!;
    return {
      kind: "outbound-action",
      action: "like",
      active: method !== "DELETE",
      externalId: `outbound:like:${targetKind}:${targetId}`,
      occurredAt,
      targetKind,
      targetId,
      targetUrl,
      targetAuthor,
      body: null,
    };
  }

  if (request.pathname === "/api/v1/restack/feed") {
    const targetId = data.commentId ?? data.comment_id ?? data.postId ?? data.post_id;
    if (targetId === undefined || targetId === null) return null;
    const targetKind = data.postId || data.post_id ? "post" : "note";
    return {
      kind: "outbound-action",
      action: "restack",
      active: method !== "DELETE",
      externalId: `outbound:restack:${targetKind}:${targetId}`,
      occurredAt,
      targetKind,
      targetId: String(targetId),
      targetUrl,
      targetAuthor,
      body: textFromBodyJson(data.bodyJson ?? data.body_json),
    };
  }

  if (request.pathname === "/api/v1/comment/feed" && method === "POST") {
    const parentId = data.parent_id ?? data.parentId;
    if (parentId === undefined || parentId === null) return null; // Publishing an owned Note, not a relationship action.
    const id = responseId(input.response);
    return {
      kind: "outbound-action",
      action: "reply",
      active: true,
      externalId: id ? `comment-${id}` : `outbound:reply:${parentId}:${occurredAt}`,
      occurredAt,
      targetKind: "comment",
      targetId: String(parentId),
      targetUrl,
      targetAuthor,
      body: textFromBodyJson(data.bodyJson ?? data.body_json) ?? (typeof data.body === "string" ? data.body : null),
    };
  }

  const postComment = /^\/api\/v1\/post\/(\d+)\/comments?$/.exec(request.pathname);
  if (postComment && method === "POST") {
    const id = responseId(input.response);
    const targetId = postComment[1]!;
    return {
      kind: "outbound-action",
      action: "comment",
      active: true,
      externalId: id ? `comment-${id}` : `outbound:comment:post:${targetId}:${occurredAt}`,
      occurredAt,
      targetKind: "post",
      targetId,
      targetUrl,
      targetAuthor,
      body: textFromBodyJson(data.bodyJson ?? data.body_json) ?? (typeof data.body === "string" ? data.body : null),
    };
  }

  const deletedComment = /^\/api\/v1\/comment\/(\d+)$/.exec(request.pathname);
  if (deletedComment && method === "DELETE") {
    return {
      kind: "outbound-action",
      action: "comment",
      active: false,
      externalId: `comment-${deletedComment[1]}`,
      occurredAt,
      targetKind: "comment",
      targetId: deletedComment[1]!,
      targetUrl,
      targetAuthor,
      body: null,
    };
  }

  return null;
}
