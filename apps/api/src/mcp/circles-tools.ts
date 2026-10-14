import { z } from "zod"
import { personInput } from "../routes/v1/people.js"
import { createInput, updateInput } from "../routes/v1/notes.js"
import type { McpScope } from "./scopes.js"

export const entityId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9:_-]+$/)
const dateTime = z.iso.datetime({ offset: true })
const page = { limit: z.number().int().min(1).max(100).default(50), cursor: z.string().max(1000).optional() }
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
const named = { name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional() }
const contactTag = { name: named.name, color }
const noteTag = { name: z.string().trim().min(1).max(60), color }
const noteIds = { id: entityId }

export interface CirclesTool {
  name: string
  description: string
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  path: string
  inputSchema: z.ZodObject
  scopes: McpScope[]
  bodyFields?: string[]
}

const read = ["circles:read"] satisfies McpScope[]
const organize = ["circles:organize"] satisfies McpScope[]
const draft = ["circles:notes:write"] satisfies McpScope[]
const publish = ["circles:notes:write", "circles:notes:publish"] satisfies McpScope[]
const sync = ["circles:sync"] satisfies McpScope[]

function tool(name: string, description: string, method: CirclesTool["method"], path: string,
  shape: z.ZodRawShape, scopes: McpScope[], bodyFields?: string[]): CirclesTool {
  return { name: `circles_${name}`, description, method, path, inputSchema: z.object(shape), scopes, bodyFields }
}

export const circlesTools: CirclesTool[] = [
  tool("get_account", "Read the current Circles tenant identity.", "GET", "/me", {}, read),
  tool("get_overview", "Read CRM counts and relationship queues; data is locally synced.", "GET", "/circles", {}, read),
  tool("get_settings", "Read the existing priority-queue settings.", "GET", "/settings", {}, read),
  tool("update_settings", "Change priority queue thresholds using the same settings as the app.", "PATCH", "/settings", {
    priorityQueue: z.object({
      minInbound: z.number().int().min(0).max(10000).optional(),
      maxOutbound: z.number().int().min(0).max(10000).optional(),
      minRestacks: z.number().int().min(0).max(10000).optional(),
      driftingMinDays: z.number().int().min(0).max(3650).optional(),
      driftingMaxDays: z.number().int().min(0).max(3650).optional(),
      vipScoreThreshold: z.number().int().min(0).max(100000).optional(),
    }),
  }, organize),
  tool("list_people", "Search locally synced contacts, including priority, needs-reply and outbound views. Pagination uses offset.", "GET", "/people", {
    search: z.string().max(500).optional(),
    status: z.enum(["new", "reach-out", "contacted", "conversation", "active", "archived"]).optional(),
    view: z.enum(["all", "needs-reply", "awaiting-response", "mutual", "priority", "conversations", "inbound", "outbound", "no-history", "opportunities", "follows-not-subscribed", "ignored"]).default("all"),
    sort: z.enum(["engagement", "recent_conversation", "recent_interaction", "name", "inbound", "outbound", "priority"]).optional(),
    tagId: entityId.optional(), listId: entityId.optional(),
    since: dateTime.optional(), until: dateTime.optional(),
    hasRestack: z.boolean().optional(), hasComment: z.boolean().optional(), hasLike: z.boolean().optional(),
    actionType: z.enum(["restack", "comment", "like", "all"]).optional(),
    limit: page.limit, offset: z.number().int().min(0).default(0),
  }, read),
  tool("get_person", "Read a contact's CRM details, private notes, lists, tags and engagement statistics.", "GET", "/people/:personId", { personId: entityId }, read),
  tool("create_person", "Create a CRM contact. Does not follow or subscribe on Substack.", "POST", "/people", personInput.shape, organize),
  tool("update_person", "Edit CRM profile fields, private notes or relationship state; does not alter interaction history.", "PATCH", "/people/:personId", { personId: entityId, ...personInput.partial().shape }, organize),
  tool("archive_person", "Archive a contact while preserving their interaction history.", "DELETE", "/people/:personId", { personId: entityId }, organize),
  tool("list_person_interactions", "Read a cursor-paginated contact timeline with separate inbound/outbound actions.", "GET", "/people/:personId/interactions", { personId: entityId, ...page }, read),
  tool("refetch_person", "Queue a paced contact refresh. Returns the existing job identifier.", "POST", "/people/:personId/refetch", { personId: entityId }, sync),
  tool("get_person_refetch", "Read a contact refresh job's state.", "GET", "/people/:personId/refetch/:jobId", { personId: entityId, jobId: z.string().regex(/^\d+$/) }, read),
  tool("list_comments", "Read synced comments received on your Notes/posts. Default window is the preceding 48 hours; supply both since and until for history.", "GET", "/comments", {
    ...page, search: z.string().max(500).optional(), status: z.enum(["all", "pending", "not-interested"]).default("all"),
    kind: z.enum(["all", "note", "post"]).default("all"), excludeResponded: z.boolean().default(false),
    since: dateTime.optional(), until: dateTime.optional(),
  }, read),
  tool("set_comment_not_interested", "Dismiss or restore a received comment in the CRM; does not delete it on Substack.", "PATCH", "/comments/:id", { id: entityId, notInterested: z.boolean() }, organize),
  tool("list_lists", "Read CRM contact lists and membership counts.", "GET", "/lists", {}, read),
  tool("create_list", "Create a CRM contact list.", "POST", "/lists", named, organize),
  tool("update_list", "Rename a CRM list or change its description.", "PATCH", "/lists/:listId", { listId: entityId, ...named }, organize),
  tool("delete_list", "Delete a CRM list and its membership edges; preserve contacts and interactions.", "DELETE", "/lists/:listId", { listId: entityId }, [...organize, "circles:delete"]),
  tool("add_list_member", "Add a contact to a CRM list.", "POST", "/lists/:listId/members", { listId: entityId, personId: entityId }, organize, ["personId"]),
  tool("remove_list_member", "Remove a contact from a CRM list without deleting the contact.", "DELETE", "/lists/:listId/members/:personId", { listId: entityId, personId: entityId }, organize),
  tool("list_contact_tags", "Read the CRM contact tag catalog.", "GET", "/tags", {}, read),
  tool("create_contact_tag", "Create a CRM contact tag.", "POST", "/tags", contactTag, organize),
  tool("update_contact_tag", "Rename or recolor a CRM contact tag.", "PATCH", "/tags/:tagId", { tagId: entityId, ...contactTag }, organize),
  tool("delete_contact_tag", "Delete a contact tag and its assignments.", "DELETE", "/tags/:tagId", { tagId: entityId }, [...organize, "circles:delete"]),
  tool("attach_contact_tag", "Assign a CRM contact tag.", "POST", "/tags/:tagId/people", { tagId: entityId, personId: entityId }, organize, ["personId"]),
  tool("detach_contact_tag", "Remove a CRM contact tag assignment.", "DELETE", "/tags/:tagId/people/:personId", { tagId: entityId, personId: entityId }, organize),
  tool("get_connection", "Read sanitized Substack connection status; never returns credentials.", "GET", "/connection", {}, read),
  tool("get_sync_status", "Read local sync timestamps and status; outbound history may be partial.", "GET", "/sync", {}, read),
  tool("get_sync_progress", "Read recent queued sync progress and safe counters.", "GET", "/sync/progress", {}, read),
  tool("request_sync", "Queue activity sync; never blocks for a full backfill.", "POST", "/sync", {}, sync),
  tool("sync_subscribers", "Queue the existing full reconciling subscriber sweep.", "POST", "/sync/subscribers", {}, sync),
  tool("sync_followers", "Queue the existing full follower sweep.", "POST", "/sync/followers", {}, sync),
  tool("list_imports", "Read historical import streams, checkpoints and completeness limits.", "GET", "/imports", {}, read),
  tool("start_import", "Start a paced historical import using existing queue rules; a running import may be paused by the app.", "POST", "/imports", {
    streams: z.array(z.enum(["activity", "outbound_actions", "owned_notes", "owned_posts", "subscribers", "followers", "following", "missing_handles"])).min(1).max(8),
    days: z.number().int().min(1).max(92).optional(), months: z.number().int().min(1).max(3).optional(), cutoffDate: dateTime.optional(),
  }, sync),
  ...(["pause", "resume", "cancel"] as const).map((action) => tool(`${action}_import`, `${action} an existing historical import.`, "POST", `/imports/:id/${action}`, noteIds, sync)),
  tool("refresh_notes", "Refresh the complete Substack draft mirror subject to the app's throttle.", "POST", "/notes/refresh", {
    from: dateTime.optional(), to: dateTime.optional(), force: z.enum(["0", "1"]).default("0"),
  }, sync, []),
  tool("create_note_draft", "Create a Substack draft through Circles. Reuse clientRequestId on retries to prevent duplicate drafts.", "POST", "/notes", {
    ...createInput.shape, mode: z.literal("draft").default("draft"),
  }, draft),
  tool("schedule_note", "Create a Note scheduled by Substack. Validate time (up to 92 days ahead); reuse clientRequestId on retries.", "POST", "/notes", {
    ...createInput.shape, mode: z.literal("schedule").default("schedule"), triggerAt: dateTime,
  }, publish),
  tool("post_note_now", "Schedule a new Note 60 seconds ahead using the app's abort window. This publishes externally.", "POST", "/notes", {
    ...createInput.shape, mode: z.literal("post_now").default("post_now"),
  }, publish),
  tool("update_note_draft", "Edit an open Note draft. Changing a scheduled Note to draft also unschedules it; this tool rejects scheduled targets.", "PATCH", "/notes/:id", {
    id: entityId, ...updateInput.shape, mode: z.literal("draft").default("draft"),
  }, draft),
  tool("reschedule_note", "Schedule/reschedule an existing Note. Preserve attachments and obey the 3-second publication cutoff.", "PATCH", "/notes/:id", {
    id: entityId, ...updateInput.shape, mode: z.literal("schedule").default("schedule"), triggerAt: dateTime,
  }, publish),
  tool("unschedule_note", "Return a scheduled Note to drafts using the same safeguards as the app.", "PATCH", "/notes/:id", {
    id: entityId, ...updateInput.shape, mode: z.literal("draft").default("draft"),
  }, publish),
  tool("publish_existing_note", "Schedule an existing draft for publication 60 seconds ahead.", "PATCH", "/notes/:id", {
    id: entityId, ...updateInput.shape, mode: z.literal("post_now").default("post_now"),
  }, publish),
  tool("abort_note", "Abort a post-now Note before the app's publication cutoff.", "POST", "/notes/:id/abort", noteIds, publish),
  tool("delete_note", "Delete a Note/draft through the existing app safeguards. External deletion is irreversible.", "DELETE", "/notes/:id", noteIds, [...draft, "circles:delete"]),
  tool("list_note_tags", "Read Circles-only Note tags, separate from contact tags.", "GET", "/notes/tags", {}, read),
  tool("create_note_tag", "Create a Circles-only Note tag.", "POST", "/notes/tags", noteTag, organize),
  tool("update_note_tag", "Rename/recolor a Circles-only Note tag.", "PATCH", "/notes/tags/:tagId", { tagId: entityId, name: noteTag.name.optional(), color }, organize),
  tool("delete_note_tag", "Delete a Note tag and its assignments without deleting Notes.", "DELETE", "/notes/tags/:tagId", { tagId: entityId }, [...organize, "circles:delete"]),
  tool("set_note_tags", "Replace a Note's Circles-only tags; also works for published note:<id> identifiers.", "PUT", "/notes/:id/tags", {
    id: entityId, tagIds: z.array(entityId).max(20),
  }, organize),
]

export function operationRequest(tool: CirclesTool, args: Record<string, unknown>) {
  const remaining = { ...args }
  const path = tool.path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    delete remaining[key]
    return encodeURIComponent(String(args[key]))
  })
  const url = new URL(path, "http://circles.internal")
  let body: Record<string, unknown> | undefined
  if (tool.method === "GET" || tool.bodyFields) {
    const bodyKeys = new Set(tool.bodyFields ?? [])
    body = tool.method === "GET" ? undefined : Object.fromEntries(Object.entries(remaining).filter(([key]) => bodyKeys.has(key)))
    for (const [key, value] of Object.entries(remaining))
      if (!bodyKeys.has(key) && value !== undefined) url.searchParams.set(key, String(value))
  } else if (tool.method !== "DELETE") body = remaining
  return new Request(url, {
    method: tool.method,
    ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}
