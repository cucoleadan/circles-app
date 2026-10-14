export const MCP_PERMISSIONS = {
  "circles:read": "Read your CRM, private contact notes, comments and scheduled Notes",
  "circles:organize": "Edit contacts, lists, tags, queue settings and comment triage",
  "circles:notes:write": "Create and edit Note drafts and upload attachments",
  "circles:notes:publish": "Schedule, reschedule, unschedule and publish Notes",
  "circles:sync": "Refresh Substack data and manage historical imports",
  "circles:delete": "Delete Notes, lists and tags",
  "substack:read": "Read live Substack content, account and publication analytics",
  "substack:records": "Read explicitly requested raw analytics and subscriber records",
} as const

export type McpScope = keyof typeof MCP_PERMISSIONS
export const MCP_SCOPES = Object.keys(MCP_PERMISSIONS) as McpScope[]
export const MCP_READ_SCOPES: McpScope[] = ["circles:read", "substack:read"]

export function requireScopes(granted: ReadonlySet<string>, required: readonly McpScope[]) {
  const missing = required.filter((scope) => !granted.has(scope))
  if (missing.length) throw new Error(`Additional permission required: ${missing.join(" ")}`)
}
