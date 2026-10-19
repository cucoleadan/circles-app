# Circles CRM — agent project scope

This is the durable technical briefing for AI/coding agents working in this
repository. Read `todo.md` for current progress and `circles-crm-vps-rebuild.md`
for the original rebuild plan. Keep this file accurate when architecture or
operations materially change.

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
The user confirmed the October 15 revision works: it uses local signing-key
verification and finite JSON transport responses. A subsequent alias deduplication
awaits release: discovery lists up to 75 tools (18 canonical SDK reads plus 57
Circles operations), omitting duplicate camelCase SDK names and, since October
19, any tool the grant's scopes do not allow. SDK reads wait up to 20 s and
return the result inline before falling back to `circles_get_tool_run`. Previously queued aliases
remain executable through the unchanged worker SDK bridge.

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

Current latest source migration is `034_mcp_tool_runs.sql` (private SDK runs,
grant revocation and tenant RLS); `033_mcp_oauth.sql` adds the Better Auth
OAuth/JWK schema. Migration `032_comment_triage.sql` adds received-comment triage.
Migration `031_replay_post_previews.sql` re-queues the evidence replay so outbound
post Likes/restacks gain `metadata.targetImage`/`targetPublication` for timeline
preview cards. Migration `030_note_tags.sql` adds the Circles-only `note_tags`
catalog and `scheduled_note_tags` edges. Migration `029_scheduled_notes.sql`
adds the `scheduled_notes` mirror of the
account's Substack Note drafts and `substack_connections.drafts_reconciled_at`.
Migration `028_retry_evidence_replay.sql` re-queues the evidence replay after
ingestion stopped restoring soft-removed duplicate Likes/restacks beside their
active row. Migration `027` adds the
`seed_missing_activity_syncs()` `SECURITY DEFINER` function the worker calls
every 5 minutes to restart the recurring sync for any active connection that
lost its job chain, and queues an evidence replay that recovers activity the old
3-hour `created_at` filter discarded. Migration `026` stores safe per-job sync counters
for the tenant-scoped `/api/v1/sync/progress` panel; activity jobs link their
scheduled child jobs for progress tracking. Migration `025` fills missing public
profile links for contacts with valid stored handles, without fetching or
merging identities. Migration `024` allows
follow interactions and resumes activity sync for active connections stranded
by the check constraint. Migration `023_import_current_following.sql`
queues a following sweep that imports missing outbound profiles. Migration
`022_repair_missing_handles.sql`
queues a paced stable-ID handle repair pass for active connections. Migration
`021_resume_scheduled_sync.sql`
seeds a due activity job for active connections stranded by the recurring
scheduler bug. Migration `020_relationship_directions_and_handle_backfill.sql`
separates outbound following/subscriptions and adds stable-ID handle repair.
Migration `019_audience_import_streams.sql`
adds subscriber and follower sweeps to selectable, resumable import runs.
Migration `018_subscriber_sync_progress.sql` adds authoritative subscriber-sweep
progress so completed refreshes can clear stale memberships safely. Migration
`017_audience_sync_progress.sql` separates
follower-check progress from the false follower state so audience sweeps can
cover every eligible contact without repeatedly selecting the same people.
Migration `011_interaction_target_context.sql` preserves the content acted on by
Likes/restacks, repairs it from retained evidence, and soft-removes proven
duplicate active actions. Migration `010_substack_request_pacing.sql` spaces
authenticated Substack work and repairs imports stranded by the old 429 policy.
Migration `009_merge_proven_profile_duplicates.sql` performs evidence-backed
handle/profile-ID contact reconciliation and never merges by display name.

Database roles:

- Admin URL/role: migration bootstrap only.
- `circles_migrate`: owns schema objects and executes migrations.
- `circles_app`: restricted DML runtime role used by API and worker.

Tenant isolation uses PostgreSQL RLS and transaction-local
`set_config('app.user_id', ...)`. All tenant reads/writes must run through
`withTenant`. A direct query through `APP_DATABASE_URL` without tenant context
correctly returns no tenant rows. Do not disable RLS to work around this.

Local `.env` normally points `DATABASE_URL`/`APP_DATABASE_URL` at an SSH tunnel
on `127.0.0.1:5433`. If it returns `ECONNREFUSED`, the tunnel is down; do not
retry repeatedly. `bun run dev` opens the tunnel and starts the local services,
while `bun run dev:check` only checks connectivity. Never print credentials or
connection strings containing passwords.

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
Subscriber and follower audience sweeps import missing people into the CRM and
reconcile current membership after the complete upstream snapshot is applied.
Scheduled audience sweeps (subscribers, followers, following) run at most once
per ~23 hours per connection. The daily subscriber refresh reads only new
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
timelines. A global grouped per-action analytics view is still pending; consult
`todo.md` before claiming otherwise.

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

The extension version must match in all four files:

- `extension/manifest.json`
- `extension/package.json`
- `extension/package-lock.json`
- `extension/version.json`

Build with:

```powershell
cd extension
bun run build
```

Build output is `extension/dist`. The installable archive convention is
`extension/circles-companion-<version>.zip`, containing the contents of `dist`
at the archive root. Rebuild/repackage after extension source changes and verify
the version in `dist/manifest.json`. Do not bump or rebuild the extension for a
web/API-only change unless requested or required for compatibility.

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
bun --env-file=.env test --concurrent-test-files=1 packages/core apps/worker apps/api
```

Useful focused commands:

```powershell
bun test packages/core/test/ingestion.test.ts apps/worker/test/jobs.test.ts
bun test extension/tests/outbound-action.test.ts
bun --env-file=.env apps/api/src/migrate.ts
```

API/database tests need the PostgreSQL tunnel and create/apply the schema in a
test database. Extension's older Vitest-oriented tests are not part of the root
test command; do not interpret Bun/Vitest harness incompatibility as a product
failure. Add new focused tests in the existing harness style and always run
typecheck after cross-package interface changes.

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
