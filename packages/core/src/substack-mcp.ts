import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer, SubstackClient } from "unofficial-substack-sdk"

/** Public MCP protocol composition avoids copying the SDK's schemas and calculations. */
export async function withSubstackMcp<T>(sdk: SubstackClient, work: (client: Client) => Promise<T>) {
  const server = createMcpServer(sdk)
  const client = new Client({ name: "circles-substack-bridge", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return await work(client)
  } finally {
    await client.close()
    await server.close()
  }
}

export function discoverSubstackTools() {
  return withSubstackMcp(new SubstackClient({
    sessionToken: "tool-discovery-only",
    fetch: async () => { throw new Error("Tool discovery must never fetch Substack") },
  }), async (client) => (await client.listTools()).tools)
}

export function callSubstackTool(sdk: SubstackClient, name: string, args: Record<string, unknown>) {
  return withSubstackMcp(sdk, (client) => client.callTool({ name, arguments: args }, undefined, { timeout: 260_000 }))
}

/** SDK text content mirrors structured data; sanitize both before storing/returning it. */
export function redactMcpResult(value: unknown, sessionToken: string): unknown {
  if (typeof value === "string") {
    const safe = sessionToken ? value.replaceAll(sessionToken, "[redacted]") : value
    try { return JSON.stringify(redactMcpResult(JSON.parse(safe), sessionToken)) }
    catch { return safe }
  }
  if (Array.isArray(value)) return value.map((item) => redactMcpResult(item, sessionToken))
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).filter(([key]) => !/token|cookie|password|authorization|secret/i.test(key))
      .map(([key, item]) => [key, redactMcpResult(item, sessionToken)]),
  )
  return value
}
