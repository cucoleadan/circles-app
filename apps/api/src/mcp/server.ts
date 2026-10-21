import { setTimeout as sleep } from "node:timers/promises"
import { McpServer, createMcpHandler, fromJsonSchema, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { mcpResource } from "../auth.js"
import { audit, listPeople } from "../db/repositories.js"
import { withTenant } from "../db/tenant.js"
import { getNoteRow, listNotes, noteView } from "../db/scheduled-notes.js"
import { listComments } from "../db/comments.js"
import { tenantOperations } from "../routes/v1.js"
import { circlesTools, entityId, operationRequest } from "./circles-tools.js"
import { localDayRange } from "./day.js"
import { MCP_SCOPES, requireScopes } from "./scopes.js"
import { enqueueSdkTool, getSdkRun, SDK_CACHE_MS, SDK_REFRESH_MIN_MS, sdkScopes, substackTools, type McpPrincipal } from "./sdk-tools.js"
import { McpUnauthorized, principalFor } from "./auth.js"
export { principalFor } from "./auth.js"

export const toolResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: { data },
})

const resultSchema = z.object({ data: z.unknown() })
// ponytail: API-side DB poll per waiting call; LISTEN/NOTIFY if many agents wait at once.
const SDK_WAIT_MS = 20_000
const SDK_POLL_MS = 1_000
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

// Clients such as Cursor request exactly these; consent still defaults to read-only.
const challenge = `Bearer resource_metadata="${new URL(mcpResource).origin}/.well-known/oauth-protected-resource/api/mcp", scope="${["offline_access", ...MCP_SCOPES].join(" ")}"`

/** Exported for transport/schema tests; the HTTP entry always supplies a verified principal. */
export function createCirclesMcp(principal: McpPrincipal) {
  const server = new McpServer({ name: "circles", version: "1.0.0" }, { capabilities: { tools: {} } })
  const operations = tenantOperations(principal.appUserId, principal.scopes)
  const call = async (work: () => Promise<unknown>) => {
    try { return toolResult(await work()) }
    catch (error) {
      return { ...toolResult({ error: error instanceof Error ? error.message : "The operation failed" }), isError: true }
    }
  }
  // List only what the grant can run; handlers still check scopes.
  const granted = (scopes: readonly string[]) => scopes.every((scope) => principal.scopes.has(scope))
  for (const tool of circlesTools) if (granted(tool.scopes)) server.registerTool(tool.name, {
    description: `${tool.description} Required permissions: ${tool.scopes.join(", ")}.`,
    inputSchema: tool.inputSchema, outputSchema: resultSchema,
    annotations: { ...readAnnotations, readOnlyHint: tool.method === "GET", destructiveHint: tool.method === "DELETE",
      idempotentHint: tool.method === "GET" || tool.method === "PUT" || tool.method === "DELETE", openWorldHint: tool.path.startsWith("/notes") && tool.method !== "GET" },
  }, (args) => call(async () => {
    requireScopes(principal.scopes, tool.scopes)
    const target = tool.name === "circles_update_note_draft"
      ? tenantOperations(principal.appUserId, principal.scopes, true) : operations
    const response = await target.fetch(operationRequest(tool, args))
    const data = response.status === 204 ? { success: true } : await response.json() as Record<string, unknown>
    if (tool.method !== "GET") await withTenant({ appUserId: principal.appUserId }, (client) =>
      audit(client, principal.appUserId, `mcp.${response.ok ? "ok" : "failed"}.${tool.name}`, "oauth-client", principal.clientId))
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Operation failed (${response.status})`)
    if (tool.name === "circles_list_people") return { ...data, nextOffset: Array.isArray(data.people) && data.people.length === args.limit ? Number(args.offset) + Number(args.limit) : null }
    return data
  }))

  if (granted(["substack:read"])) {
    type SdkResult = { content?: unknown[]; structuredContent?: unknown; isError?: boolean; _meta?: Record<string, unknown> }
    const sdkResult = (result: SdkResult) => result.structuredContent || result.isError ? result : toolResult(result)
    // Tell the agent how old the data is, so it does not refetch to "check".
    const withFreshness = (result: SdkResult, fetchedAt: Date | string, cached: boolean): ReturnType<typeof toolResult> => {
      const at = new Date(fetchedAt).toISOString()
      return { ...result, _meta: { ...result._meta, "circles/fetchedAt": at, "circles/cached": cached },
        content: [...(result.content ?? []), { type: "text" as const, text: cached
          ? `Served from the Circles server cache (fetched ${at}). Use it; pass refresh: true only when the user explicitly needs live data.`
          : `Live Substack read fetched ${at}; later calls with the same arguments use this cached copy.` }] } as ReturnType<typeof toolResult>
    }
    for (const tool of substackTools) server.registerTool(tool.name, {
      title: tool.title, description: `${tool.description ?? tool.name} Returns the Circles server's cached copy (refreshed from Substack at most every ${SDK_CACHE_MS / 3600000} hours). Prefer circles_* tools for CRM data. Set refresh: true only when the user explicitly asks for live data; the live read is queued, paced and waited for (up to ${SDK_WAIT_MS / 1000}s, then poll circles_get_tool_run), and is ignored when the cache is under ${SDK_REFRESH_MIN_MS / 60000} minutes old. Requires substack:read; raw/record opt-ins also require substack:records.`,
      inputSchema: fromJsonSchema<Record<string, unknown>>({ ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
        refresh: { type: "boolean", default: false, description: "Force a live Substack read instead of the server cache. Only when the user explicitly asks for live data." } } }),
      outputSchema: resultSchema, annotations: tool.annotations,
    }, async ({ refresh, ...args }) => {
      const queued = await call(async () => {
        const scopes = sdkScopes(args)
        requireScopes(principal.scopes, scopes)
        return enqueueSdkTool(principal, tool.name, args, scopes, refresh === true)
      })
      if ("isError" in queued) return queued
      const queuedData = queued.structuredContent.data as { runId: string } | { cached: { result: SdkResult; fetchedAt: Date } }
      if ("cached" in queuedData) return withFreshness(sdkResult(queuedData.cached.result), queuedData.cached.fetchedAt, true)
      const { runId } = queuedData
      for (const deadline = Date.now() + SDK_WAIT_MS; Date.now() < deadline;) {
        await sleep(SDK_POLL_MS)
        const run = await getSdkRun(principal, runId).catch(() => null)
        // The worker stores the SDK's own content/structuredContent/isError.
        if (run?.result) return run.result.isError ? run.result : withFreshness(sdkResult(run.result), run.finishedAt ?? new Date(), false)
        if (run && run.status !== "pending" && run.status !== "running")
          return { ...toolResult({ error: "The SDK read failed; check the Substack connection and try again", runId }), isError: true }
      }
      return queued
    })

    server.registerTool("circles_get_tool_run", {
      description: "Poll an SDK read that did not finish inline. On completion, result contains the original SDK content/structuredContent; isError reports upstream failure.",
      inputSchema: z.object({ runId: z.string().uuid() }), outputSchema: resultSchema, annotations: readAnnotations,
    }, ({ runId }) => call(() => getSdkRun(principal, runId)))
  }

  if (granted(["circles:notes:write"])) server.registerTool("circles_upload_note_image", {
    description: "Upload PNG/JPEG/GIF/WebP bytes for a Note, up to 15 MB, through the app's existing image validation. Returns metadata to use in Note attachments.",
    inputSchema: z.object({ base64: z.string().min(1).max(20 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
    outputSchema: resultSchema, annotations: { ...readAnnotations, readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  }, ({ base64 }) => call(async () => {
    requireScopes(principal.scopes, ["circles:notes:write"])
    const form = new FormData()
    form.set("file", new File([Buffer.from(base64, "base64")], "note-image"))
    const response = await operations.fetch(new Request("http://circles.internal/notes/images", { method: "POST", body: form }))
    const data = await response.json() as Record<string, unknown>
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Image upload failed")
    return data
  }))

  if (granted(["circles:read"])) server.registerTool("circles_list_notes", {
    description: "Read the local draft/scheduled/published Note mirror. Filter by status or scheduled time. Published history uses the app's 500-row cap; get_notes/get_profile_notes provide live cursor history.",
    inputSchema: z.object({
      from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
      status: z.enum(["all", "draft", "scheduled", "published", "pending"]).default("all"),
      tagId: entityId.optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0),
    }), outputSchema: resultSchema, annotations: readAnnotations,
  }, (args) => call(async () => {
    requireScopes(principal.scopes, ["circles:read"])
    const from = args.from ?? new Date(Date.now() - 31 * 86400000).toISOString()
    const to = args.to ?? new Date(Date.now() + 93 * 86400000).toISOString()
    const fromMs = Date.parse(from), toMs = Date.parse(to)
    if (fromMs >= toMs) throw new Error("from must be before to")
    const data = await listNotes(principal.appUserId, { from, to })
    const notes = data.notes.filter((note) => (args.status === "all" || note.status === args.status) &&
      (!args.tagId || note.tags.some((tag) => tag.id === args.tagId)) &&
      (!note.triggerAt || (Date.parse(note.triggerAt) >= fromMs && Date.parse(note.triggerAt) < toMs)))
    return { connection: data.connection, notes: notes.slice(args.offset, args.offset + args.limit),
      nextOffset: notes.length > args.offset + args.limit ? args.offset + args.limit : null, publishedHistoryLimit: 500 }
  }))

  if (granted(["circles:read"])) server.registerTool("circles_get_note", {
    description: "Read a mirrored Note with full editor content and attachment IDs, or published note:<id> content retained in Circles.",
    inputSchema: z.object({ id: entityId }), outputSchema: resultSchema, annotations: readAnnotations,
  }, ({ id }) => call(async () => {
    requireScopes(principal.scopes, ["circles:read"])
    const note = await withTenant({ appUserId: principal.appUserId }, async (client) => {
      const row = await getNoteRow(client, id)
      if (!row) return (await client.query(
        `select external_id as "substackDraftId", 'note:' || external_id as id,
           'published' as status, body as "bodyText", null as "bodyJson", false as editable,
           url as "noteUrl", published_at as "publishedAt" from owned_content
         where kind = 'note' and external_id = $1 order by updated_at desc limit 1`,
        [id.startsWith("note:") ? id.slice(5) : id],
      )).rows[0] ?? null
      const connection = (await client.query("select profile_handle from substack_connections where id = $1", [row.connectionId])).rows[0]
      return noteView(client, row, connection?.profile_handle ?? null)
    })
    if (!note) throw new Error("Note not found")
    return { note }
  }))

  if (granted(["circles:read"])) server.registerTool("circles_get_note_engagement", {
    description: "Read synced likes, restacks and replies on one of your Notes, with counts and the people involved. Comes from the 10-minute activity sync and reply-tree refreshes, not a live Substack read.",
    inputSchema: z.object({ noteId: entityId, limit: z.number().int().min(1).max(200).default(50) }),
    outputSchema: resultSchema, annotations: readAnnotations,
  }, ({ noteId, limit }) => call(async () => {
    requireScopes(principal.scopes, ["circles:read"])
    const id = noteId.startsWith("note:") ? noteId.slice(5) : noteId
    return withTenant({ appUserId: principal.appUserId }, async (client) => {
      const match = "i.removed_at is null and i.thread_kind = 'note' and (i.thread_root_id = $1 or i.target_id = $1)"
      const counts = (await client.query(
        `select i.direction, i.action_type as "actionType", count(*)::int as total
         from interactions i where ${match} group by 1, 2 order by 1, 2`, [id],
      )).rows
      const interactions = (await client.query(
        `select i.direction, i.action_type as "actionType", i.occurred_at as "occurredAt", i.body,
           p.id as "personId", p.name, p.handle
         from interactions i left join people p on p.id = i.person_id
         where ${match} order by i.occurred_at desc limit $2`, [id, limit],
      )).rows
      return { noteId: id, counts, interactions, coverage: "Locally synced evidence; grouped notifications and old removed actions may be incomplete." }
    })
  }))

  if (granted(["circles:read"])) server.registerTool("circles_get_day_brief", {
    description: "Read a daily agenda from the local CRM: scheduled Notes for a local calendar day, draft summaries, recent pending comments and existing priority/needs-reply queues. Does not publish, send replies or refresh upstream.",
    inputSchema: z.object({ date: z.iso.date(), timeZone: z.string().max(100).default(() => Intl.DateTimeFormat().resolvedOptions().timeZone), limit: z.number().int().min(1).max(50).default(10) }),
    outputSchema: resultSchema, annotations: readAnnotations,
  }, (args) => call(async () => {
    requireScopes(principal.scopes, ["circles:read"])
    const range = localDayRange(args.date, args.timeZone)
    const [notes, queues] = await Promise.all([
      listNotes(principal.appUserId, range),
      withTenant({ appUserId: principal.appUserId }, async (client) => ({
        comments: await listComments(client, { status: "pending", excludeResponded: true, limit: args.limit }),
        priority: await listPeople(client, { view: "priority", limit: args.limit, sort: "priority" }),
        needsReply: await listPeople(client, { view: "needs-reply", limit: args.limit }),
      })),
    ])
    return { date: args.date, timeZone: args.timeZone, range, fetchedAt: new Date().toISOString(), connection: notes.connection,
      scheduled: notes.notes.filter((note) => note.status === "scheduled" && note.triggerAt && note.triggerAt >= range.from && note.triggerAt < range.to),
      drafts: notes.notes.filter((note) => note.status === "draft").slice(0, args.limit).map(({ bodyJson: _, ...note }) => note),
      ...queues, commentWindow: "preceding 48 hours", coverage: "Locally synced evidence; outbound history may be partial. Request a refresh separately." }
  }))

  return server
}

/** Both protocol generations use the SDK and return finite JSON responses. */
export async function handleMcpRequest(request: Request, principal: McpPrincipal): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  if (await isLegacyRequest(request, undefined, { maxRequestBodySize: 24 * 1024 * 1024 })) {
    const server = createCirclesMcp(principal)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 24 * 1024 * 1024,
    })
    try {
      await server.connect(transport)
      return await transport.handleRequest(request)
    } finally { await server.close() }
  }
  const handler = createMcpHandler(() => createCirclesMcp(principal), {
    legacy: "reject", responseMode: "json", maxRequestBodySize: 24 * 1024 * 1024,
  })
  try { return await handler.fetch(request) }
  finally { await handler.close() }
}

export const mcpRoutes = new Hono()
const origins = new Set([new URL(mcpResource).origin, "https://dash.cloudflare.com", ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)])
mcpRoutes.use("*", async (c, next) => {
  const origin = c.req.header("origin")
  if (origin && !origins.has(origin)) {
    console.warn("[MCP] forbidden origin", JSON.stringify({ origin }))
    return c.json({ error: "Forbidden origin" }, 403)
  }
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin)
    c.header("Vary", "Origin")
  }
  c.header("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version")
  await next()
})
mcpRoutes.options("/", (c) => {
  c.header("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS")
  c.header("Access-Control-Allow-Headers", "Authorization, DPoP, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, MCP-Method, MCP-Name")
  return c.body(null, 204)
})
mcpRoutes.use("/", bodyLimit({ maxSize: 24 * 1024 * 1024 }))
mcpRoutes.on(["POST", "GET", "DELETE"], "/", async (c) => {
  let principal: McpPrincipal
  try { principal = await principalFor(c.req.raw) }
  catch (error) {
    if (!(error instanceof McpUnauthorized)) {
      console.error("[MCP] authentication unavailable", { name: error instanceof Error ? error.name : "Unknown" })
      return c.json({ error: "Authentication is temporarily unavailable" }, 503)
    }
    c.header("WWW-Authenticate", challenge)
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Unauthorized" } }, 401)
  }
  return handleMcpRequest(c.req.raw, principal)
})
