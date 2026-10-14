import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { auth, mcpResource } from "../auth.js"
import { audit, getOrCreateAppUser, listPeople } from "../db/repositories.js"
import { withTenant } from "../db/tenant.js"
import { getNoteRow, listNotes, noteView } from "../db/scheduled-notes.js"
import { listComments } from "../db/comments.js"
import { tenantOperations } from "../routes/v1.js"
import { circlesTools, entityId, operationRequest } from "./circles-tools.js"
import { localDayRange } from "./day.js"
import { MCP_READ_SCOPES, requireScopes } from "./scopes.js"
import { enqueueSdkTool, getSdkRun, sdkScopes, substackTools, type McpPrincipal } from "./sdk-tools.js"

export const toolResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: { data },
})

const resultSchema = z.object({ data: z.unknown() })
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

export async function principalFor(request: Request): Promise<McpPrincipal> {
  const authorization = request.headers.get("authorization") ?? ""
  const match = /^(Bearer|DPoP) ([^\s]+)$/i.exec(authorization)
  if (!match) throw new Error("Unauthorized")
  const claims = await auth.api.verifyMcpAccess({ body: {
    authorization, proof: request.headers.get("dpop") ?? undefined,
    method: request.method as "POST" | "GET" | "DELETE",
  } })
  if (typeof claims.sub !== "string" || typeof claims.client_id !== "string" || typeof claims.iat !== "number")
    throw new Error("Unauthorized")
  const appUserId = await getOrCreateAppUser(claims.sub)
  const grant = await withTenant({ appUserId }, async (client) => (await client.query(
    `select g.scopes from "oauthConsent" g where g."clientId" = $1 and g."userId" = $3
       and g.resources @> $4::jsonb and not exists (
         select 1 from mcp_grant_revocations where client_id = $1 and extract(epoch from revoked_at) >= $2
       ) limit 1`,
    [claims.client_id, claims.iat, claims.sub, JSON.stringify([mcpResource])],
  )).rows[0])
  if (!grant || !Array.isArray(grant.scopes)) throw new Error("Unauthorized")
  return { appUserId, authUserId: claims.sub, clientId: claims.client_id, issuedAt: claims.iat,
    scopes: new Set((typeof claims.scope === "string" ? claims.scope.split(" ") : []).filter((scope) => grant.scopes.includes(scope))) }
}

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
  for (const tool of circlesTools) server.registerTool(tool.name, {
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

  for (const tool of substackTools) server.registerTool(tool.name, {
    title: tool.title, description: `${tool.description ?? tool.name} Live Substack read, queued and paced. Returns a runId; poll circles_get_tool_run for the SDK result. Requires substack:read; raw/record opt-ins also require substack:records.`,
    inputSchema: z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
      .pipe(z.record(z.string(), z.unknown())), outputSchema: resultSchema,
    annotations: tool.annotations,
  }, (args) => call(async () => {
    const scopes = sdkScopes(args)
    requireScopes(principal.scopes, scopes)
    return enqueueSdkTool(principal, tool.name, args, scopes)
  }))

  server.registerTool("circles_get_tool_run", {
    description: "Poll a queued SDK MCP read. On completion, result contains the original SDK content/structuredContent; isError reports upstream failure.",
    inputSchema: z.object({ runId: z.string().uuid() }), outputSchema: resultSchema, annotations: readAnnotations,
  }, ({ runId }) => call(() => getSdkRun(principal, runId)))

  server.registerTool("circles_upload_note_image", {
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

  server.registerTool("circles_list_notes", {
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

  server.registerTool("circles_get_note", {
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

  server.registerTool("circles_get_day_brief", {
    description: "Read a daily agenda from the local CRM: scheduled Notes for a local calendar day, draft summaries, recent pending comments and existing priority/needs-reply queues. Does not publish, send replies or refresh upstream.",
    inputSchema: z.object({ date: z.iso.date(), timeZone: z.string().max(100).default("Europe/Bucharest"), limit: z.number().int().min(1).max(50).default(10) }),
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

export const mcpRoutes = new Hono()
const origins = new Set([new URL(mcpResource).origin, "https://dash.cloudflare.com", ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)])
mcpRoutes.use("*", async (c, next) => {
  const origin = c.req.header("origin")
  if (origin && !origins.has(origin)) return c.json({ error: "Forbidden origin" }, 403)
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin)
    c.header("Vary", "Origin")
  }
  c.header("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version")
  await next()
})
mcpRoutes.options("/", (c) => {
  c.header("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS")
  c.header("Access-Control-Allow-Headers", "Authorization, DPoP, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id")
  return c.body(null, 204)
})
mcpRoutes.use("/", bodyLimit({ maxSize: 24 * 1024 * 1024 }))
mcpRoutes.on(["POST", "GET", "DELETE"], "/", async (c) => {
  let principal: McpPrincipal
  try { principal = await principalFor(c.req.raw) }
  catch {
    c.header("WWW-Authenticate", `Bearer resource_metadata="${new URL(mcpResource).origin}/.well-known/oauth-protected-resource/api/mcp", scope="${MCP_READ_SCOPES.join(" ")}"`)
    return c.json({ error: "Unauthorized" }, 401)
  }
  const handler = createMcpHandler(() => createCirclesMcp(principal), { legacy: "stateless", responseMode: "json" })
  try { return await handler.fetch(c.req.raw) }
  finally { await handler.close() }
})
