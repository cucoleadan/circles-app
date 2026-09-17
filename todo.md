# Circles CRM rebuild — progress tracker

Tracks implementation against `circles-crm-vps-rebuild.md` (phases in section 10).
Update this file as work completes. Last updated: 2026-09-17.

## Where we are

**Phase 3 (Ingestion and Sync) is complete and verified (26/26 tests passing across core, worker, and api; full Turbo typecheck passing across 6 packages). Phase 4 (Circles UI) starts next.**

What exists:

- Bun/Turborepo monorepo: `apps/web` (Astro SSR + React island), `apps/api`
  (Hono + Better Auth + `pg`), `apps/worker` (background queue runner),
  `packages/ui`, `@workspace/core` (Substack client adapter + ingestion engine),
  `extension` (Chrome MV3 passive capture & companion bridge).
- Migrations runner (`apps/api/src/migrate.ts`) with `app_migrations` ledger;
  `001_auth.sql` through `005_engagement_score.sql` (full schema with tenant RLS,
  composite foreign keys, and 1/2/3/3 engagement score calculation).
- Phase 3 Ingestion & Sync:
  - `@workspace/core`: `createSubstackClient`, `ingestActivityBatch`, `ingestConversationReplies`, `refreshPersonStats` (likes=1, restacks=2, comments=3, notes=3).
  - `apps/worker`: Job runner with `FOR UPDATE SKIP LOCKED`, lease fencing, bounded retries with backoff, dead-letter terminal states, `sync:activity` (15-min cadence), `import:history` (resumable checkpoints), and `enrich:profile`.
  - `apps/api`: `/connection` (GET/POST/DELETE), `/sync` (POST with 60s cooldown), `/imports` (GET/POST/pause/resume), `/api/ext` and `/app` compatibility routes.
- Browser extension: integrated with Circles origins (`circles.mhntwrkdan.dev`, `localhost:4321`), direct plaintext session envelope, passive activity/conversation capture.
- Automated test coverage: 26/26 tests passing (`bun run test`).
- Typecheck: 0 errors across 6 packages (`bun run typecheck`).

---

## Phase 0 — Baseline (complete)

- [x] VPS/Dokploy PostgreSQL service exists; dev tunnel works; DB reachable
- [x] Inventory live D1 schema, row counts, ID formats, malformed data
- [x] Exported live D1 data (`scripts/migration/export-d1.ts`) and imported into PostgreSQL (`scripts/migration/d1-convert.ts`): 692 people, 1,891 interactions, 4 lists, 32 members, 0 quarantined
- [x] Link Better Auth user (`cucoleadan@gmail.com`) to imported `app_users` record
- [x] Capture sanitized Substack fixtures for SDK validation
- [x] Verify pinned `unofficial-substack-sdk` release (0.3.14)
- [x] Admin recovery procedure (`apps/api/src/reset-password.ts`)

## Phase 1 — Foundation (complete, pending deploy smoke test)

- [x] Monorepo workspace, build/typecheck/lint via Turborepo
- [x] Astro SSR (node standalone) + React islands, dev proxy for `/api`
- [x] Hono API + `/api/health`, `/api/ready`
- [x] Better Auth (email/password, `basePath: /api/auth`, trusted origins, sign-up closed)
- [x] `pg` pool + versioned SQL migrations + `app_migrations` ledger
- [x] Compose: migrate one-shot gate, api healthcheck, worker, web; Dokploy network
- [x] Worker stub with graceful shutdown
- [x] Same-origin cookie flow SSR→API verified in dev
- [x] Separate DB roles: `circles_migrate` (owns schema objects, runs migrations)
      and `circles_app` (DML-only runtime role for api/worker); auto-bootstrapped
      by the migrate service each deploy; verified live (DML ok / DDL denied /
      default privileges on new tables)
- [x] Production guard: api/worker refuse to start without `APP_DB_PASSWORD`
- [x] `web` service receives no DB credentials in compose
- [x] Admin password reset runbook (`apps/api/src/reset-password.ts` + `docs/operations.md`)
- [x] Hardening: `Cache-Control: no-store` on `/api` responses; origin check on
      cookie-authenticated writes (403 verified); Better Auth handles `/api/auth` origins
- [x] Docs updated for Cloudflare Tunnel ingress (no Traefik)
- [x] Deployed via Dokploy (git remote, compose env managed through the Dokploy API)
      and smoke-tested live through the Cloudflare Tunnel: `/api/ready` + `/api/health`
      OK with `no-store`, cross-origin write 403, sign-in through the tunnel sets a
      Better Auth session and the authed SSR page renders, no DB ports published
      (only the 127.0.0.1-bound dev proxy) — Phase 1 gate closed 2026-09-17
- [ ] Backup role/policy deferred to Phase 6 (Dokploy scheduled backups are interim)

## Phase 2 — Database and CRM (complete 2026-09-17, pending deploy)

- [x] Minimal `contacts` table + CRUD endpoints (superseded by `people`)
- [x] Full schema per plan section 7 (`003_crm.sql` + `004_crm_import.sql`):
  - [x] `app_users` (CRM ownership, distinct from Better Auth `user`;
        `auth_user_id` nullable until the Phase 6 link)
  - [x] `substack_connections` (plain envelopes, revocation/status, generation)
  - [x] `people` (profile IDs, provenance/source, archive state, legacy status merge)
  - [x] `tags`, `person_tags` (+ composite ownership constraints)
  - [x] `lists`, `list_members` (delete list only removes membership edges)
  - [x] `saved_views` (pinned views, tag xor list)
  - [x] `interactions` (direction, `thread_kind` namespaces, external IDs,
        metadata, provenance via `connection_id`/`source`)
  - [x] `profile_snapshots` / `thread_snapshots`
  - [x] `activity_snapshots` / `note_replies_snapshots` (capture evidence)
  - [x] `sync_state` / `import_runs` (cutoff, cursor, counts, paused state)
  - [x] `ingestion_batches`, `relationship_stats`, `audit_log`
  - [x] Jobs/lease columns: lease token fencing, expiry, bounded attempts, terminal states
  - [x] Indexes per query shapes: `(user_id, normalized_handle)`, membership edges,
        `(user_id, person_id, occurred_at DESC, id DESC)`, thread lookups,
        unique source event keys, due-job index
- [x] Dedicated `APP_DATABASE_URL` env var; api/worker no longer receive the
      admin `DATABASE_URL` string (compose, local `.env`, Dokploy env updated)
- [x] Typed repositories (`apps/api/src/db/`: `tenant.ts` transaction-local
      `app.user_id`, `repositories.ts` parameterized SQL)
- [x] API surface per plan section 6: `/api/v1/circles`, `/api/v1/people`,
      `/api/v1/people/:id/interactions` (keyset cursor pagination), `/api/v1/lists`,
      `/api/v1/tags`, `/api/v1/me`; `/api/contacts` kept as a thin compat layer
      with status translation for the interim UI
- [x] D1 → PostgreSQL migration converter (`scripts/migration/`): `d1-export.sh`
      (wrangler), `d1-convert.ts` (dependency-ordered import, reconciliation
      report, quarantine/flagged rows, `legacy_engagements` staging with
      provenance); representative fixture import verified against a throwaway
      `circles_test` database — real D1 export runs at the Phase 6 rehearsal
- [x] RLS on all tenant tables (`app_tenant_id()` policies); runtime role is
      `circles_app` (non-owner, non-superuser); `circles_migrate` keeps owner
      bypass for migration tooling only
- [x] Tenant-isolation and transactional-edit tests (Phase 2 gate):
      10/10 passing (`bun --env-file=.env test apps/api`) — RLS isolation,
      no-context visibility, cross-tenant edge rejection, atomic edits with
      rollback, handle normalization, archive semantics, interaction dedupe,
      stable cursor pagination

Phase 2 incident log: a broken statement-bisect script run during migration
debugging dropped the Phase 1 `contacts` placeholder before its port could run
(only test data existed). `003_crm.sql` now guards the port with
`to_regclass`, so fresh and already-migrated databases both apply cleanly.

## Phase 3 — Ingestion and sync (complete 2026-09-17)

- [x] `packages/substack`-equivalent adapter: `@workspace/core` with pinned SDK 0.3.14
- [x] Worker job runner: claim via `FOR UPDATE SKIP LOCKED`, lease fencing,
      bounded retries, exponential backoff, dead-letter terminal states
- [x] Incremental activity sync job (15-min cadence) + manual refresh cooldown (60s)
- [x] Profile enrichment sweep (`enrich:profile`, monotonic enrichment rule)
- [x] Conversation/thread enrichment with cursors and recursive hierarchy
- [x] Historical import job (`import:history`, 3-month/configurable default, resumable checkpoints)
- [x] Single ingestion path: SDK reads + extension captures (`ingestActivityBatch`)
- [x] Monotonic enrichment rule; direction/thread namespaces
- [x] Scoring calculation per plan (Likes=1, Restack=2, Comment=3, Restack with note=3)
- [x] Per-account rate limits; pause/stop on expired credentials
- [x] Gate: replays deduplicate; interrupted imports resume; tests passing (26/26)

## Phase 4 — Circles UI

- [ ] SSR first page + API-paginated subsequent pages (URL-addressable filters/selection)
- [ ] Views: Conversations, Inbound, Outbound, No history, Opportunities
- [ ] Sorts: last conversation, last engagement, interaction count, name
- [ ] Distinct timestamps: last interaction / heard from them / from you / last conversation
- [ ] Contact drawer: edit, tags, lists, archive; preserve private notes on enrichment
- [ ] Timeline: thread grouping, provenance, incomplete-thread marking, stable pagination
- [ ] Directory/table view for bulk browsing + list management
- [ ] List/tag management UI (create/rename/delete, memberships, pinned views)
- [ ] Gate: agreed Circles/CRM acceptance flows pass on desktop and mobile

## Phase 5 — Extension

- [ ] `/api/ext/companion`, `/api/ext/activity` compatibility routes
- [ ] Thin POST adapters for `/app/settings`, `/app/companion`, `/app/community`
- [ ] Durable `ingestion_batches` ack; dedupe replay; reject other user's queued data
- [ ] Update origin allowlists, manifest, version/download files
- [ ] Gate: add-to-list, capture, reconnect, offline replay pass end to end

## Phase 6 — Cutover rehearsal

- [ ] Full D1 backup + Clerk identity export; inventory/reconciliation
- [ ] Better Auth users from Clerk export; link to `app_users`; password hash policy
- [ ] Scoped import + counts/checksums reconciliation; recompute summaries
- [ ] Backup restore test; measured read performance vs. targets; rollback rehearsal

## Phase 7 — Release

- [ ] Stop legacy writers; final import; switch ingress; revoke old sessions
- [ ] Enable worker authority; smoke tests; rollback artifacts retained
- [ ] Post-rollback-window: remove Clerk/legacy dependencies

## Test debt (ongoing)

- [ ] Port `tests/community/*`, `user-resolution`, activity tests, extension tests
- [ ] PostgreSQL integration tests (against PG, not SQLite)
- [ ] Required scenarios from plan section 12 as they become implementable
