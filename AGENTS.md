# Circles CRM — agent project scope

This is the durable technical briefing for AI/coding agents working in this
repository. Read `todo.md` for open work and `README.md` for setup. Keep this
file accurate when architecture or operations materially change.

## Product purpose

Circles is a private relationship CRM for a Substack account. It turns Substack
activity, authored Notes/posts, and their conversations into people,
interactions, relationship statistics, filters, and timelines. It consists of a
web app, API, PostgreSQL-backed worker, and a Chrome companion extension.

## Repository architecture

This is a Bun/Turborepo monorepo. Use Bun, not npm/pnpm/yarn.

- `apps/web`: Astro SSR application with a client-side React workspace and
  shared shadcn-style components from `packages/ui`.
- `apps/api`: Hono API, Better Auth, PostgreSQL repositories, extension bridge,
  and ordered SQL migrations.
- `apps/worker`: PostgreSQL job runner for incremental sync, imports,
  enrichment, and retained-evidence reprocessing.
- `packages/core`: shared Substack SDK adapter and canonical ingestion logic.
- `packages/ui`: shared React UI primitives.
- `extension`: Chrome Manifest V3 companion extension. It connects the user's
  browser Substack session, observes successful Substack responses/mutations,
  and durably queues captures for the API.
- `apps/api/migrations`: append-only PostgreSQL migrations, applied in filename
  order and recorded in `app_migrations`.
- `docs/operations.md`: production topology, environment variables, database
  roles, recovery steps, and smoke tests.
- `todo.md`: authoritative implementation status and known remaining gates.

All TypeScript packages are ESM. Preserve the existing `.js` suffix on local
imports where the surrounding source uses it; compiled output runs directly in
Bun/Node-compatible ESM mode.

## Runtime and request flow

Production is built from `Dockerfile` and orchestrated by `compose.yaml` on
Dokploy. Cloudflare Tunnel provides public ingress; this application is not a
Cloudflare Worker.

The public host routes `/api/*` to the Hono API and other traffic to the Astro
web service. Web, API, worker, PostgreSQL, and the one-shot migration service
communicate on the shared `dokploy-network`.

Authentication is Better Auth with same-origin cookies. Clerk is retired and
must not be reintroduced. `app_users` is the CRM tenant identity linked to the
Better Auth user.

The source also implements `/api/mcp`: Better Auth 1.7.7 OAuth/MCP authorization
uses the same user/tenant, scoped grants and revocation; the stateless HTTP
transport accepts modern and 2025-era clients. It composes all SDK MCP tools
with `circles_*` app operations. SDK reads enter `mcp:substack` jobs and keep
private results in tenant-scoped `mcp_tool_runs`, never job logs. Browser grant
management is `/mcp`; optional Cloudflare Access OIDC must be explicitly linked
to an existing account. Gateway Code Mode is external. See `docs/mcp.md`.
It uses local signing-key verification and finite JSON transport responses.
Discovery lists up to 69 tools (12 canonical SDK reads plus 57 Circles
operations), omitting duplicate camelCase SDK names, the six SDK reads Circles already
syncs (profile, activity, unread activity, own Notes, following, Note
engagement), and any tool the grant's
scopes do not allow. SDK reads return the server's cached run for the same
tool/arguments (under 6 h old); only a miss or `refresh: true` (ignored within
10 min of the last fetch) queues a live read, which waits up to 20 s inline
before falling back to `circles_get_tool_run`. Previously queued aliases remain
executable through the unchanged worker SDK bridge.

The extension calls compatibility routes under `/api/ext/*`. Its durable queue
is scoped to the active `substack_connections.id`, preventing captures from a
revoked or different Substack account from being delivered into the current
account.

## Deployment and PostgreSQL migrations

The user normally pushes changes; Dokploy automatically builds and deploys the
git revision. Do not push, change Dokploy, or perform a release unless the user
explicitly asks.

PostgreSQL migrations are applied automatically on every deployment:

1. Dokploy starts the one-shot `migrate` service.
2. `apps/api/dist/migrate.js` bootstraps/refreshes database roles using the
   admin `DATABASE_URL`.
3. It runs every unapplied file in `apps/api/migrations` transactionally and
   records it in `app_migrations`.
4. `api` and `worker` are gated on successful migration completion.

Therefore, every schema change must be a new, forward-only numbered SQL file.
Never edit an already-deployed migration, manually mutate the production
schema, or assume application code starts before its migration succeeds.
Migrations may also enqueue repair jobs when a data-model/parser change needs
to reprocess retained evidence.

Each migration starts with a comment explaining why it exists; read the latest
few before adding one. Data-repair migrations (for example `009`, `011`,
`027`, `028`, `031`) queue jobs that replay retained evidence instead of
refetching, and `027` adds the `seed_missing_activity_syncs()` `SECURITY
DEFINER` function the worker calls every 5 minutes to restart the recurring
sync for any active connection that lost its job chain.

Database roles:

- Admin URL/role: migration bootstrap only.
- `circles_migrate`: owns schema objects and executes migrations.
- `circles_app`: restricted DML runtime role used by API and worker.

Tenant isolation uses PostgreSQL RLS and transaction-local
`set_config('app.user_id', ...)`. All tenant reads/writes must run through
`withTenant`. A direct query through `APP_DATABASE_URL` without tenant context
correctly returns no tenant rows. Do not disable RLS to work around this.

`bun run dev` uses `DATABASE_URL` directly, or, when `CIRCLES_SSH_HOST` and
`CIRCLES_SSH_DB_ENV_FILE` are set, opens an SSH tunnel to a remote database on
`127.0.0.1:5433` first; `bun run dev:check` only checks connectivity. If the
database returns `ECONNREFUSED`, it (or the tunnel) is down; do not retry
repeatedly. Never print credentials or connection strings containing passwords.

## Data model and ingestion invariants

Important tables include:

- `substack_connections`: versioned account connections and session material.
- `people`: CRM contacts. A handle is optional; `substack_profile_id` is the
  stable identity when Substack omits a handle.
- `interactions`: normalized inbound/outbound actions with stable external IDs,
  target/thread context, event time, source, and soft removal via `removed_at`.
- `relationship_stats`: rebuildable counts/timestamps and separate inbound and
  outbound scores.
- `owned_content`: authored Notes/posts used as conversation sync seeds.
- `activity_snapshots`, `note_replies_snapshots`, `thread_snapshots`, and
  `ingestion_batches`: raw evidence retained for safe replay.
- `sync_stream_state`: independent incremental stream status/checkpoints.
- `import_runs` and `import_run_streams`: resumable user-visible backfills.
- `jobs`: durable queue with leases, retries, and dead-letter state.

Canonical normalization belongs in `packages/core/src/ingestion.ts`; API,
worker, and extension captures must converge on that path instead of creating
parallel scoring/identity logic.

Relationship rules:

- Inbound engagement score reflects engagement received from another person.
- Outbound engagement is tracked separately and must never inflate the inbound
  score.
- A confirmed owner action attaches to the target/parent author when known.
- Owner replies in a thread are outbound interactions with the person being
  replied to.
- Unrelated third-party discussion must not be relabeled as a direct
  interaction with the owner.
- Stable Substack profile ID takes precedence over handle; handle is optional
  enrichment.
- Replays must be idempotent. Undo operations mark the existing interaction
  removed and a subsequent repeat restores it.

## Sync and historical coverage

Scheduled/manual sync polls the activity (notification) feed every 10 minutes,
reading pages newest-first back to the last
successful activity sync minus a 30-minute overlap (at most 5 pages; first sync
reads one page) and ingests every item on those pages without a time filter,
because grouped notifications gain new senders after creation. At most every 3
hours per connection a poll also queues the audience sweeps and heavier refreshes: it refreshes the
reply trees of the 6 newest owned Notes from the last 7 days and the 3 newest
posts from the last 14 days, and re-reads the newest Likes and restacks pages
over a 24-hour window. Separately, every 30 minutes it re-reads up to 40 of the
owner's authored replies from the last 24 hours (Substack ignores `limit` and
returns ~12 per page, so this follows the cursor). The `sync:activity` job never
dead-letters except on session expiry; the worker's queue maintenance re-seeds
it for any active connection without one, and connecting schedules it at once.
Connecting rejects a session Substack does not verify, keeping the current
connection. Session tokens are encrypted at rest when `SESSION_TOKEN_KEY` is
set; always read them through `openSessionToken`, never `ciphertext` directly.
The activity sync re-seals a legacy `plain` session once the key is configured.
Subscriber and following audience sweeps import missing people into the CRM and
reconcile current membership after the complete upstream snapshot is applied.
Scheduled audience sweeps (subscribers, following) run at most once per ~23
hours per connection. Following reads the ID-only `/api/v1/feed/following` and
queues the missing-handle backfill to name new contacts. There is no follower
sweep: Substack's follower list (`subscriber-lists`) answers non-browser
clients with a Cloudflare challenge, so `is_follower` comes only from follow
notifications in the activity sync. It is never cleared, because Substack
sends no unfollow notification. The daily subscriber refresh reads only new
subscribers (incremental, stopping at the stored checkpoint, never reconciling);
the full reconciling sweep that detects unsubscribes runs at most once per 7 days.
Historical cursors belong to backfill jobs, not incremental sync. Activity,
owned Notes, owned posts, and outbound history have independent
status/completeness state so one stream cannot silently advance another.

Be precise about upstream limits:

- Substack's activity feed is primarily inbound/notification history.
- Owned Notes and posts plus their returned reply/comment trees can be
  backfilled and kept current.
- Historical owner replies present in retained owned-content threads can be
  recovered.
- Authenticated profile feeds expose deep cursor-paginated active Likes,
  restacks, and authored comments/replies. They do not guarantee that actions
  removed in the past remain available.
- The extension captures future outbound likes/unlikes,
  restacks/unrestacks, comments, and replies when their mutation succeeds.
- Never label unavailable outbound history as complete. The frontend explains
  the limitation without showing it as a permanently failed progress card.

The CRM exposes recovered/captured outbound data through the Outbound Touches
view, “given” totals on contact cards, outbound timestamps, and per-contact
timelines. `GET /api/v1/circles` returns `actions` (active interactions grouped
by direction and action type with all-time, 7-day and 30-day counts), shown as
the given/received strip under the overview metrics.

## Note scheduling

The `/notes` page writes and schedules Substack Notes through
`/api/v1/notes/*` (`apps/api/src/routes/v1/notes.ts`). Substack owns every
draft and publishes scheduled drafts at `trigger_at` itself; Circles runs no
publish job. `scheduled_notes` mirrors the account's drafts (including those
created in Substack's app) and is refreshed from the complete
`getAllDraftNotes` list, throttled per connection. A published Note keeps its
draft ID, which matches `owned_content.external_id`. "Post now" schedules 60
seconds ahead so the user can abort; mutations within 3 seconds of
`trigger_at` are refused. Validate `trigger_at` (at most 92 days ahead) before
calling Substack, because a rejected time still leaves a stray draft. Always
re-send the attachment IDs to keep on draft updates. Note tags
(`/api/v1/notes/tags`, `PUT /notes/:id/tags`) are Circles-only and separate from
contact tags; tagging a published Note listed from `owned_content`
(`note:<id>`) creates a published mirror row to hold them. Design notes:
`plans/note-scheduling.md`.

## Extension workflow

The extension version must match in `extension/manifest.json` and
`extension/package.json`. Users pair any Circles server from the popup: `lib/app-origin.ts` validates it
(https, or http only for localhost), requests that single origin from
`optional_host_permissions`, stores it, and registers `content.js` there with
`chrome.scripting`. The background re-registers on install/update and also
pairs on `permissions.onAdded` because the popup can close during the prompt.
Every install starts unpaired (the popup opens as a setup page); the only
required host permission is Substack. Package with:

```powershell
cd extension
bun run pack
```

That writes `extension/circles-companion-<version>.zip` (git-ignored) with the
contents of `dist` at the archive root, and refuses a build whose required host
permissions include localhost. When a push to `main` changes the manifest
version, `.github/workflows/extension-release.yml` packs it and publishes the
`extension-v<version>` GitHub Release; do not upload releases by hand. Do not bump or rebuild the
extension for a web/API-only change unless requested or required for
compatibility.

The passive page observer must not introduce extra Substack reads merely to
capture normal browsing. Mutation capture may resolve a missing target author
through the authenticated API route. Treat all page-world messages as untrusted:
validate type, shape, length, origin, and account connection before queueing or
ingesting them.

## Development and verification

Common commands from the repository root:

```powershell
bun run typecheck
bun run build
bun run test
```

Useful focused commands:

```powershell
bun test packages/core/test/ingestion.test.ts apps/worker/test/jobs.test.ts
bun test extension/tests/outbound-action.test.ts
bun --env-file=.env apps/api/src/migrate.ts
```

API/database tests need a reachable PostgreSQL (`DATABASE_URL` admin plus the
role passwords) and create/apply the schema in a `circles_test` database. The
root test command also runs the extension and web lib tests under `bun:test`.
Add new focused tests in the existing harness style and always run typecheck
after cross-package interface changes.

Before handing off a change:

1. Check `git status` and preserve unrelated user changes.
2. Add a migration for schema changes and confirm it works on a fresh/test DB
   when the tunnel is available.
3. Run typecheck and tests proportional to the change.
4. Update `todo.md` when scope or completion status changes.
5. State what was not tested, deployed, migrated, rebuilt, or pushed.

## Safety and operational expectations

- Never expose Substack session tokens, database passwords, Better Auth
  secrets, raw private message bodies, or full connection URLs in logs/output.
- Prefer aggregate/structural inspection of retained payloads when debugging
  production data.
- Do not run destructive SQL, delete imports/interactions, reset git state, or
  revoke connections without explicit user authorization.
- Do not bypass the queue for long-running sync/backfill work.
- Do not mark a backfill complete when an upstream stream is unavailable or a
  checkpoint has not exhausted.
- Preserve raw snapshots when adjusting parsers; replay evidence rather than
  refetching private upstream data when possible.
- Keep UI language honest about complete, partial, and unavailable coverage.
