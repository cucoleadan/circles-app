# Circles MCP

The source provides `${APP_URL}/api/mcp`, a stateless remote MCP endpoint for
Cloudflare MCP server portals/Code Mode and other OAuth-capable HTTP clients.

## Tools and data sources

There are 69 tools: 12 of the SDK's read capabilities under their snake_case
names, plus 57 `circles_*` tools. The SDK's 18 duplicate camelCase aliases are
omitted from registration, as are six reads Circles already syncs:
`get_authenticated_profile` (use `circles_get_connection`), `get_activity` and
`get_unread_activity` (the 10-minute activity sync behind `circles_list_people`,
`circles_list_comments` and contact timelines), `get_notes` (use
`circles_list_notes`; `get_profile_notes` reads other profiles), `get_following`
(the daily following sweep, `circles_list_people` view `following`) and
`get_note_engagement` (`circles_get_note_engagement`, synced likes, restacks
and replies on one of your Notes). Discovery lists only the tools the token's scopes
allow: a `circles_*` tool needs all its listed scopes, and the SDK reads plus
`circles_get_tool_run` need `substack:read`. The 401 challenge advertises every
scope, so clients that copy it (Cursor) request write access too; the consent
page still leaves write permissions unchecked until the user selects them. A
client granted only read sees only the read tools. To add write access, re-run
its authorization (e.g. Cursor: log out of the server and reconnect) and select
the write permissions on the consent page. Handlers still check scopes, and
raw/record opt-ins still require `substack:records` at call time. The SDK factory supplies its schemas
and handlers; Circles uses the public in-memory MCP bridge rather than copying
analytics calculations. All tools have typed inputs, structured results and
read-only/destructive annotations. Code Mode runs in the Cloudflare portal.

- SDK names such as `get_notes`, `get_post_analytics`, `get_publication_analytics`,
  `get_growth_sources`, subscriber and activity tools return the server's cached
  copy of a Substack read; see below.
- Circles tools manage contacts, CRM notes, lists/contact tags, received-comment
  triage, queue settings, Note drafts/attachments/scheduling and Note tags.
- Sync/import tools queue the same existing background operations as the app.
- `circles_get_day_brief` combines local-day scheduled Notes, draft summaries,
  recent pending comments, priority contacts and needs-reply queues. Its default
  timezone is the API server's (`TZ`, e.g. `Europe/Bucharest`). It generates no content or automatic reminders;
  the caller's agent/scheduler does that.

Tool results use `structuredContent.data`. SDK calls are served from the
server's cache: the newest successful run of the same tool and arguments for the
active connection (shared by all of the account's clients) is returned if it is
under 6 hours old, with `_meta["circles/fetchedAt"]` and a text note giving its
age. Agents pass `refresh: true` (stripped before reaching the SDK) only when
the user explicitly needs live data; a refresh still reuses a copy under 10
minutes old. Only a cache miss or an honoured refresh queues a paced
`mcp:substack` job; the API waits up to 20 seconds, checking once a second.
If the run finishes, the call returns the SDK's original `content`,
`structuredContent` and optional `isError` directly, with credentials removed.
Otherwise it returns `{runId,status,pollTool}` in `data`; poll
`circles_get_tool_run({runId})`, whose `data.result` holds the same SDK result
on completion. Check `isError` even when the job status is `done`. Observed
runs finish in 5–25 seconds depending on queue depth. Avoid tight polling;
allow a few seconds between requests. Ten SDK jobs per
tenant may be queued/running; duplicate pending calls with the same client,
connection, arguments and token issuance time reuse the same run.

SDK work has a four-minute budget and a 2 MB result limit. Narrow large requests
or disable raw rows if a limit is exceeded; failures are explicit, not partial
results mislabeled complete. SDK cursors, limits and raw/record flags retain
their input semantics. Private results are stored in RLS-protected rows, not
the job's log/result counters. Current retention has no automatic expiry;
completed runs remain private until a retention policy is explicitly added.

`circles_list_notes` reads the app mirror, with status/tag/time filters and
offset pagination. Drafts have no publication time. Published CRM history uses
the app's 500-row cap; use SDK `get_notes` / `get_profile_notes` for live cursor
history. Historical outbound coverage remains partial where Substack cannot
supply old removed actions. Publication administration tools need an upstream
administrator session and the correct stored publication URL.

## Authentication and grants

Sign in through the existing Circles Better Auth account and authorize each
client. The browser keeps its cookie; the client receives separate resource-
bound OAuth tokens. Tokens are checked for issuer, audience, expiry, active
client/session, current consent and per-tool scopes. DPoP tokens require a proof
bound to the canonical resource URL/method with database-backed replay storage.
Arbitrary Cloudflare email/user headers do not establish a CRM identity.
Signing keys are loaded through Better Auth's local API, without a loopback HTTP
request. Auth/database failures return 503; invalid or expired credentials return
401 with OAuth discovery metadata. Refresh rotation permits the library's
30-second retry window, then rejects replay and revokes the token family.

Both 2025 and 2026 MCP requests use the official SDK and return finite JSON
responses. SDK input schemas are passed directly to its JSON Schema validator;
all canonical snake_case tool names remain available. Clients that cached
camelCase aliases need to refresh their tool list after deployment. Previously
queued calls using aliases still execute through the unchanged SDK bridge.

The consent page defaults to read permissions and offline access. Client
registration can declare all capabilities, but it grants no user permissions.
Grant publishing/deletion/raw records only when wanted:

| Scope | Access |
| --- | --- |
| `circles:read` | CRM data, private CRM notes, drafts/scheduled Notes, status and briefings |
| `circles:organize` | Contacts, lists, tags, settings and reversible comment triage |
| `circles:notes:write` | Note draft editing and attachments |
| `circles:notes:publish` | Scheduling/rescheduling/unscheduling, post-now and abort |
| `circles:sync` | Upstream refreshes and import controls |
| `circles:delete` | Note/list/tag deletion, combined with its domain permission |
| `substack:read` | Live SDK content/account/publication analytics |
| `substack:records` | Explicit raw/record flags, including subscriber personal data |

Authorizing write scopes does not change the app's scheduling rules: Substack
publishes; post-now waits 60 seconds, the three-second cutoff still applies,
attachment IDs are preserved, and scheduling is limited to 92 days ahead.
Draft-only updates reject scheduled targets, and deleting a scheduled Note
also needs publishing permission. SDK MCP tools are read-only; SDK class
methods for sending Likes/replies are not exposed automatically.

Manage and revoke connections at `/mcp`, linked from Connection settings.
Revocation stops existing access tokens, refresh tokens and subsequent queued
SDK requests for that tenant/client; it does not disable the client for other
users. Reconnecting requires consent. Logout/session expiry and connection
replacement also affect underlying token/session/upstream eligibility.

## Cloudflare portal and optional SSO

After normal migration-gated deployment:

1. Route both `/api/*` and `/.well-known/*` to the API via the existing Tunnel.
   Other paths, including `/login`, `/mcp`, and `/mcp/consent`, go to the web app.
   The web middleware also forwards public discovery to `API_INTERNAL_URL` if
   the existing tunnel sends `/.well-known/*` to the web service.
2. Add `${APP_URL}/api/mcp` as an OAuth-protected upstream server in the
   Cloudflare MCP server portal; configure Code Mode there.
3. Sign into the portal and authorize the upstream Circles account. Portal
   Managed OAuth and Circles upstream OAuth are distinct. No shared service
   token should be treated as an arbitrary end user's identity.
4. Verify discovery, read/write permission denial, a harmless read, and browser
   revocation through the real portal before granting publishing permissions.

Discovery routes are public metadata; tool calls require authentication. Do
not put an HTML Access login wall over the upstream metadata/token/MCP routes.
The portal can protect its own public connection with Access Managed OAuth.
No local Code Mode engine, gateway deployment or Cloudflare resource was added.

Optional Access-for-SaaS OIDC can provide the app's SSO login. Configure the API:

- `CLOUDFLARE_ACCESS_DISCOVERY_URL`: the trusted Access OIDC discovery URL;
  verify its issuer, JWKS and user-info support before enabling it.
- `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET`: the
  corresponding application's credentials. All three values are required.
- Register `${APP_URL}/api/auth/callback/cloudflare-access` as its redirect.
- Sign into the existing Circles account first, open `/mcp`, and link SSO.
  Implicit linking and new SSO-user registration are disabled.

Both API and worker require the same `APP_URL`; Compose now passes it to both.
For a trusted browser MCP client/inspector, set `MCP_ALLOWED_ORIGINS` to an
explicit comma-separated origin list. Server-to-server portal calls need no
browser origin allowance. Development proxies `/.well-known` and `/api` to
the API. Do not expose session/database/OIDC secrets to agents or frontend code.
The Cloudflare dashboard origin is allowed on the bearer-protected MCP endpoint.
Public OAuth token/registration/revocation/introspection and JWKS endpoints
support CORS without cookies; browser login/session/consent routes stay restricted.

## Deployment and verification status

New append-only migrations: `033_mcp_oauth.sql` and `034_mcp_tool_runs.sql`.
Better Auth and the OAuth/MCP/CIMD packages are pinned to 1.7.7. Existing user
IDs and CRM tenants remain unchanged. Use the normal migration service; never
run a separate auth migration against production.

`/mcp` is the browser management page; clients use the HTTPS `/api/mcp` URL.
Cloudflare Access SSO linking has not yet been verified against a live tenant.
