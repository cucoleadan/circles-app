import { describe, expect, spyOn, test } from "bun:test"
import { Hono } from "hono"
import { auth } from "../src/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { discoverSubstackTools, redactMcpResult } from "@workspace/core"
import { createCirclesMcp, mcpRoutes } from "../src/mcp/server.js"
import { circlesTools, operationRequest } from "../src/mcp/circles-tools.js"
import { localDayRange } from "../src/mcp/day.js"
import { requireScopes } from "../src/mcp/scopes.js"
import { sdkScopes, type McpPrincipal } from "../src/mcp/sdk-tools.js"
import { oauthProtocolRoutes } from "../src/mcp/oauth-http.js"

const principal: McpPrincipal = { appUserId: "tenant-a", authUserId: "auth-a", clientId: "test-client", issuedAt: 1, scopes: new Set() }

describe("Circles MCP protocol and tool boundaries", () => {
  test("OAuth diagnostics preserve callbacks and omit credentials", async () => {
    const callback = "https://client.test/callback?code=secret-code&state=secret-state"
    const log = spyOn(console, "info").mockImplementation(() => {})
    const handler = spyOn(auth, "handler").mockImplementation(async () => Response.json({ url: callback }))
    const app = new Hono().route("/", oauthProtocolRoutes)
    app.post("/api/auth/oauth2/consent", (c) => auth.handler(c.req.raw))
    try {
      const response = await app.request("/api/auth/oauth2/consent", { method: "POST" })
      expect(await response.json()).toEqual({ url: callback })
      expect(JSON.parse(String(log.mock.calls[0]?.[1]))).toEqual({ endpoint: "consent", status: 200,
        callback: { codePresent: true, statePresent: true, errorPresent: false } })
      handler.mockImplementation(async () => Response.json({ access_token: "secret-token", refresh_token: "secret-refresh" }))
      await app.request("/api/auth/oauth2/token", { method: "POST" })
      expect(JSON.parse(String(log.mock.calls[1]?.[1]))).toEqual({ endpoint: "token", status: 200, accessTokenPresent: true })
      handler.mockImplementation(async () => Response.json({ error: "invalid_grant", error_description: "secret-description" }, { status: 400 }))
      await app.request("/api/auth/oauth2/token", { method: "POST" })
      expect(JSON.parse(String(log.mock.calls[2]?.[1])).error).toBe("invalid_grant")
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-")
      expect(JSON.stringify(log.mock.calls)).not.toContain("client.test")
    } finally { handler.mockRestore(); log.mockRestore() }
  })

  test("OAuth protocol preflights work without opening cookie login or consent", async () => {
    const headers = { origin: "https://dash.cloudflare.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,dpop" }
    for (const endpoint of ["oauth2/token", "oauth2/register", "oauth2/revoke", "oauth2/introspect", "jwks"]) {
      const response = await oauthProtocolRoutes.request(`/api/auth/${endpoint}`, { method: "OPTIONS", headers })
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("access-control-allow-headers")).toContain("Authorization")
      expect(response.headers.get("access-control-allow-credentials")).toBeNull()
    }
    for (const endpoint of ["sign-in/email", "get-session", "oauth2/consent"]) {
      const response = await oauthProtocolRoutes.request(`/api/auth/${endpoint}`, { method: "OPTIONS", headers })
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
    }
    for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server/api/auth"]) {
      const response = await oauthProtocolRoutes.request(path, { method: "OPTIONS", headers: { ...headers, "access-control-request-method": "GET" } })
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
    }
    const mcp = await mcpRoutes.request("/", { method: "OPTIONS", headers })
    expect(mcp.status).toBe(204)
    expect(mcp.headers.get("access-control-allow-origin")).toBe("https://dash.cloudflare.com")
  })

  test("web discovery forwarding preserves API responses without browser credentials", async () => {
    const { onRequest } = await import(new URL("../../web/src/middleware.ts", import.meta.url).href)
    const originalFetch = globalThis.fetch
    const internalUrl = process.env.API_INTERNAL_URL
    const requests: Request[] = []
    let nextCalls = 0
    const next = () => { nextCalls++; return new Response("web") }
    const invoke = (path: string, method = "GET") => {
      const url = new URL(path, "https://circles.example.test")
      return onRequest({ url, request: new Request(url, { method, headers: { cookie: "private-session", authorization: "Bearer private" } }) }, next)
    }
    try {
      process.env.API_INTERNAL_URL = "http://api:3000"
      globalThis.fetch = (async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({ resource: "https://circles.example.test/api/mcp" }, { headers: { "access-control-allow-origin": "*" } })
      }) as typeof fetch
      for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server/api/auth"]) {
        const response = await invoke(path)
        expect(response.status).toBe(200)
        expect(response.headers.get("access-control-allow-origin")).toBe("*")
        expect((await response.json()).resource).toBe("https://circles.example.test/api/mcp")
        const forwarded = requests.at(-1)!
        expect(forwarded.url).toBe(`http://api:3000${path}`)
        expect(forwarded.headers.get("cookie")).toBeNull()
        expect(forwarded.headers.get("authorization")).toBeNull()
        expect(forwarded.redirect).toBe("manual")
      }
      await invoke("/.well-known/oauth-protected-resource/api/mcp", "HEAD")
      expect(requests.at(-1)!.method).toBe("HEAD")
      await invoke("/mcp")
      await invoke("/.well-known/oauth-protected-resource/api/mcp", "POST")
      expect(nextCalls).toBe(2)
      globalThis.fetch = (async () => { throw new Error("Internal connection failed") }) as typeof fetch
      const failed = await invoke("/.well-known/oauth-protected-resource/api/mcp")
      expect(failed.status).toBe(502)
      expect(await failed.text()).not.toContain("Internal connection failed")
    } finally {
      globalThis.fetch = originalFetch
      if (internalUrl === undefined) delete process.env.API_INTERNAL_URL
      else process.env.API_INTERNAL_URL = internalUrl
    }
  })

  test("parallel SDK fetches serialize the whole operation and recover after failure", async () => {
    const { serializeFetch } = await import(new URL("../../worker/src/mcp.ts", import.meta.url).href)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let releaseSecond!: () => void
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })
    const events: string[] = []
    const queued = serializeFetch(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      events.push(url)
      if (url.endsWith("first")) { await gate; throw new Error("Upstream failed") }
      await secondGate
      return Response.json({ ok: true })
    })
    const first = queued("https://example.test/first")
    const failed = expect(first).rejects.toThrow("Upstream failed")
    const second = queued("https://example.test/second")
    await Promise.resolve()
    expect(events).toEqual(["https://example.test/first"])
    release()
    await failed
    let drained = false
    const drain = queued.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    releaseSecond()
    await drain
    expect((await second).ok).toBe(true)
    expect(events).toEqual(["https://example.test/first", "https://example.test/second"])
  })

  test("SDK names, aliases and input schemas survive the HTTP composition", async () => {
    const handler = createMcpHandler(() => createCirclesMcp(principal), { legacy: "stateless", responseMode: "json" })
    const client = new Client({ name: "mcp-test", version: "1" })
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost:4321/api/mcp"), {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    })
    try {
      await client.connect(transport)
      const listed = (await client.listTools()).tools
      const original = await discoverSubstackTools()
      expect(original).toHaveLength(36)
      expect(listed.length).toBeGreaterThan(80)
      expect(new Set(listed.map((tool) => tool.name)).size).toBe(listed.length)
      for (const upstream of original) {
        const forwarded = listed.find((tool) => tool.name === upstream.name)!
        expect(forwarded).toBeDefined()
        expect(forwarded.inputSchema.properties).toEqual(upstream.inputSchema.properties)
        expect(forwarded.inputSchema.required ?? []).toEqual(upstream.inputSchema.required ?? [])
        expect(forwarded.annotations?.readOnlyHint).toBe(true)
      }
      const denied = await client.callTool({ name: "circles_create_person", arguments: { name: "Test" } })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied)).toContain("circles:organize")
      const sdkDenied = await client.callTool({ name: "get_authenticated_profile", arguments: {} })
      expect(sdkDenied.isError).toBe(true)
      expect(JSON.stringify(sdkDenied)).toContain("substack:read")
    } finally { await client.close(); await handler.close() }
  })

  test("unauthenticated calls and forged identities get OAuth discovery challenges", async () => {
    for (const headers of [{}, { "x-circles-user-id": "tenant-a", "cf-access-authenticated-user-email": "owner@example.test" }]) {
      const response = await mcpRoutes.request("/", { method: "POST", headers, body: "{}" })
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/api/mcp")
    }
    const forbidden = await mcpRoutes.request("/", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" })
    expect(forbidden.status).toBe(403)
  })

  test("permissions cannot be implied by raw options or draft input mode", () => {
    expect(sdkScopes({ include_records: true })).toEqual(["substack:read", "substack:records"])
    expect(sdkScopes({ include_raw: true })).toContain("substack:records")
    expect(sdkScopes({ include_rows: true })).toContain("substack:records")
    expect(sdkScopes({})).toEqual(["substack:read"])
    expect(() => requireScopes(new Set(["circles:notes:write"]), ["circles:notes:publish"])).toThrow()
    const draft = circlesTools.find((tool) => tool.name === "circles_create_note_draft")!
    expect(draft.inputSchema.safeParse({ clientRequestId: "request-123", bodyJson: {}, mode: "schedule" }).success).toBe(false)
  })

  test("REST delegation binds paths and preserves body versus query fields", async () => {
    const member = circlesTools.find((tool) => tool.name === "circles_add_list_member")!
    const request = operationRequest(member, { listId: "list-a", personId: "person-a" })
    expect(new URL(request.url).pathname).toBe("/lists/list-a/members")
    expect(await request.json()).toEqual({ personId: "person-a" })
    expect(circlesTools.find((tool) => tool.name === "circles_get_person")!.inputSchema.safeParse({ personId: "../connection" }).success).toBe(false)
    const refresh = circlesTools.find((tool) => tool.name === "circles_refresh_notes")!
    expect(new URL(operationRequest(refresh, { force: "1" }).url).searchParams.get("force")).toBe("1")
  })

  test("credentials are removed from structured data and mirrored text", () => {
    const input = { content: [{ type: "text", text: JSON.stringify({ sessionToken: "private-token", body: "private-token in content", count: 3 }) }], structuredContent: { authorization: "Bearer x", count: 3 } }
    const safe = redactMcpResult(input, "private-token")
    expect(JSON.stringify(safe)).not.toContain("private-token")
    expect(JSON.stringify(safe)).not.toContain("sessionToken")
    expect(JSON.stringify(safe)).not.toContain("Bearer x")
    expect(JSON.stringify(safe)).toContain("count")
  })
})

test("daily briefing calendar boundaries account for DST and invalid dates", () => {
  expect(localDayRange("2026-10-14", "Europe/Bucharest")).toEqual({ from: "2026-10-13T21:00:00.000Z", to: "2026-10-14T21:00:00.000Z" })
  const spring = localDayRange("2026-03-29", "Europe/Bucharest")
  const autumn = localDayRange("2026-10-25", "Europe/Bucharest")
  expect(Date.parse(spring.to) - Date.parse(spring.from)).toBe(23 * 3600000)
  expect(Date.parse(autumn.to) - Date.parse(autumn.from)).toBe(25 * 3600000)
  expect(() => localDayRange("2026-02-30", "Europe/Bucharest")).toThrow()
  expect(() => localDayRange("2026-10-14", "not-a-timezone")).toThrow()
})
