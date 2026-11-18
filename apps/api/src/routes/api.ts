import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { mcpResource } from "../auth.js"
import { API_KEY_RATE_LIMIT, apiKeyRetryAfter, McpUnauthorized, principalFor } from "../mcp/auth.js"
import { MCP_SCOPES } from "../mcp/scopes.js"
import { handleMcpRequest } from "../mcp/server.js"
import type { McpPrincipal } from "../mcp/sdk-tools.js"

/**
 * Plain HTTP API over the MCP tool registry: every tool is POST /api/tools/<name>
 * with its arguments as the JSON body. Calls run through the same in-process MCP
 * server, so scopes, caching, audit and the SDK-read queue behave identically.
 */
type Tool = { name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } }
type CallResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: { data?: unknown } & Record<string, unknown>; isError?: boolean; _meta?: unknown }

async function rpc<T>(principal: McpPrincipal, method: string, params: Record<string, unknown>) {
  const response = await handleMcpRequest(new Request(mcpResource, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), principal)
  return await response.json() as { result?: T; error?: { message: string } }
}

const listTools = async (principal: McpPrincipal) => (await rpc<{ tools: Tool[] }>(principal, "tools/list", {})).result?.tools ?? []
// Tool registration touches no tenant data, so the full catalogue needs no real user.
const catalogue = { appUserId: "", authUserId: "", clientId: "openapi", issuedAt: 0, scopes: new Set<string>(MCP_SCOPES) }
let allTools: Promise<Tool[]> | undefined
// Cached for the process lifetime; a failed or empty listing is retried on the next request.
const everyTool = () => allTools ??= listTools(catalogue).then((tools) => {
  if (!tools.length) throw new Error("The MCP tool registry is empty")
  return tools
}).catch((error) => { allTools = undefined; throw error })

export function openApiSpec(tools: Tool[], origin: string) {
  const error = { $ref: "#/components/schemas/Error" }
  const json = (schema: unknown) => ({ content: { "application/json": { schema } } })
  return {
    openapi: "3.1.0",
    info: { title: "Circles API", version: "1.0.0", description:
      "Every Circles MCP tool as a JSON endpoint. Create an API key with the permissions you want at /mcp and send it as " +
      "`Authorization: Bearer ck_...`. A key can call only the tools its permissions allow (GET /api/tools lists them). " +
      "Substack reads (get_*) return the server's cached copy; when a live read is still running, data holds " +
      "{runId, status} and POST /api/tools/circles_get_tool_run {runId} returns the result." },
    servers: [{ url: origin }],
    security: [{ apiKey: [] }],
    paths: {
      "/api/tools": { get: { operationId: "listTools", summary: "Tools this API key can call",
        responses: { 200: { description: "Tools", ...json({ type: "object", properties: { tools: { type: "array", items: { type: "object" } } } }) },
          401: { description: "Missing or revoked key", ...json(error) } } } },
      ...Object.fromEntries(tools.map((tool) => {
        const { $schema: _, ...input } = tool.inputSchema
        return [`/api/tools/${tool.name}`, { post: {
          operationId: tool.name, summary: tool.name, description: tool.description,
          tags: [tool.name.startsWith("circles_") ? "Circles" : "Substack"],
          requestBody: { required: false, ...json(input) },
          responses: {
            200: { description: "Result", ...json({ type: "object", properties: { data: {}, meta: { type: "object" } } }) },
            400: { description: "The body is not a JSON object or does not match the tool's arguments", ...json(error) },
            401: { description: "Missing, invalid or revoked key", ...json(error) },
            403: { description: "The key lacks a permission this tool or argument needs", ...json(error) },
            404: { description: "Unknown tool", ...json(error) },
            422: { description: "The operation failed", ...json(error) },
            429: { description: `More than ${API_KEY_RATE_LIMIT} calls in a minute; wait Retry-After seconds`, ...json(error) },
          },
        } }]
      })),
    },
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "A Circles API key (ck_...) from /mcp" } },
      schemas: { Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] } },
    },
  }
}

export const apiRoutes = new Hono<{ Variables: { principal: McpPrincipal } }>()

apiRoutes.get("/openapi.yaml", async (c) => c.body(Bun.YAML.stringify(openApiSpec(await everyTool(), new URL(mcpResource).origin), null, 2), 200,
  { "content-type": "application/yaml; charset=utf-8" }))

apiRoutes.use("/tools/*", bodyLimit({ maxSize: 24 * 1024 * 1024 }))
apiRoutes.use("/tools/*", async (c, next) => {
  try { c.set("principal", await principalFor(c.req.raw)) }
  catch (error) {
    if (error instanceof McpUnauthorized) return c.json({ error: error.message }, 401)
    console.error("[API] authentication unavailable", { name: error instanceof Error ? error.name : "Unknown" })
    return c.json({ error: "Authentication is temporarily unavailable" }, 503)
  }
  const retryAfter = apiKeyRetryAfter(c.get("principal").clientId)
  if (retryAfter) {
    c.header("Retry-After", String(retryAfter))
    return c.json({ error: `Rate limit: ${API_KEY_RATE_LIMIT} calls per minute per key` }, 429)
  }
  await next()
})

apiRoutes.get("/tools", async (c) => c.json({ tools: (await listTools(c.get("principal")))
  .map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, readOnly: annotations?.readOnlyHint === true })) }))

apiRoutes.post("/tools/:name", async (c) => {
  const name = c.req.param("name")
  if (!(await everyTool()).some((tool) => tool.name === name)) return c.json({ error: "Unknown tool; GET /api/tools lists the tools this key can call" }, 404)
  const text = await c.req.text()
  let args: unknown = {}
  try { if (text.trim()) args = JSON.parse(text) } catch { return c.json({ error: "The body must be a JSON object" }, 400) }
  if (!args || typeof args !== "object" || Array.isArray(args)) return c.json({ error: "The body must be a JSON object" }, 400)
  const { result, error } = await rpc<CallResult>(c.get("principal"), "tools/call", { name, arguments: args })
  // The MCP server registers only the tools a grant allows, so a known tool it cannot find is a missing permission.
  if (error || !result) return c.json({ error: "This API key does not have the permissions this tool requires (see /api/openapi.yaml)" }, 403)
  const structured = result.structuredContent
  const data = structured && "data" in structured ? structured.data : structured
  if (result.isError) {
    const message = (data as { error?: unknown } | undefined)?.error
    const reason = typeof message === "string" ? message
      : result.content?.map((part) => part.text).filter(Boolean).join("\n") || "The operation failed"
    const status = reason.startsWith("Additional permission required") ? 403 : reason.startsWith("Input validation error") ? 400 : 422
    return c.json({ error: reason }, status)
  }
  return c.json({ data: data ?? result.content, ...(result._meta ? { meta: result._meta } : {}) })
})
