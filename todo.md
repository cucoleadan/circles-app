# Circles CRM rebuild — progress tracker

Tracks implementation against `circles-crm-vps-rebuild.md` (phases in section 10).
Update this file as work completes. Last updated: 2026-09-17.

## Where we are

**Phase 2 (Database & CRM) is complete and verified (tests 10/10, representative D1 import reconciles); push to `main` deploys it. Phase 3 (Ingestion & sync) starts next.**

What exists:

- Bun/Turborepo monorepo: `apps/web` (Astro SSR + React island), `apps/api`
  (Hono + Better Auth + `pg`), `apps/worker` (DB heartbeat stub), `packages/ui`,
  `packages/core` (empty placeholder).
- Migrations runner (`apps/api/src/migrate.ts`) with `app_migrations` ledger;
  `001_auth.sql` (Better Auth schema, committed/reviewed per plan) and
  `002_crm.sql` (minimal `contacts` + `jobs` tables).
- Better Auth on `GET/POST /api/auth/*`, email/password, sign-up closed by
  default (`ALLOW_SIGNUP`), Hono resolves session per request.
- Minimal `/api/contacts` CRUD (create/edit/archive, handle uniqueness,
  tenant-scoped by `user_id`), `/api/health` + `/api/ready`.
- Web: login page, authenticated Circles workspace island (contact cards,
  filters, search, edit sheet) fed by server-side fetch forwarding cookies.
- `compose.yaml` (migrate → api → worker/web with health gate), Dockerfile,
  `scripts/dev.ts` SSH tunnel to the Dokploy PostgreSQL — **database is
  connected and verified**.

Notable deviations from the plan's suggested layout (accepted for now):

- Migrations live in `apps/api/migrations` instead of `packages/db`; typed
  repositories will live in `apps/api/src` (or a package) rather than
  `packages/db`/`packages/contracts`/`packages/domain`/`packages/substack`.
  Revisit if shared code between api/worker grows.

---

## Phase 0 — Baseline (partially done)

- [x] VPS/Dokploy PostgreSQL service exists; dev tunnel works; DB reachable
- [ ] Inventory live D1 schema, row counts, ID formats, malformed data
- [ ] Capture sanitized Substack fixtures for SDK validation
- [ ] Verify pinned `unofficial-substack-sdk` release vs. local checkout
- [ ] Decide admin recovery procedure (no transactional email yet) + sign-off on scope

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
  - [x] `substack_connections` (encrypted envelopes, revocation/status, generation)
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

## Phase 3 — Ingestion and sync

- [ ] `packages/substack`-equivalent adapter: profiles, activity pages, note/post
      reads, connectivity checks; pinned SDK version; schema validation
- [ ] Worker job runner: claim via `FOR UPDATE SKIP LOCKED`, lease fencing,
      bounded retries, terminal error states
- [ ] Incremental activity sync job (15-min cadence) + manual refresh cooldown
- [ ] Profile enrichment sweep (hourly, bounded freshness)
- [ ] Conversation/thread enrichment with cursors + completeness flags
- [ ] Historical import job (3-month default, resumable checkpoints)
- [ ] Single ingestion path: SDK reads + extension captures
- [ ] Monotonic enrichment rule; grouped notifications; direction/thread namespaces
- [ ] Per-account rate limits shared across api/worker; pause on expired credentials
- [ ] Gate: replays deduplicate; interrupted imports resume; page close doesn't stop work

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
