# Circles CRM rebuild — progress tracker

Tracks implementation against `circles-crm-vps-rebuild.md` (phases in section 10).
Update this file as work completes. Last updated: 2026-09-17.

## Where we are

**Phases 0–5 are complete. Phase 5.5 is implemented with documented upstream coverage limits; the remaining Phase 5.5 work is live reconciliation and richer per-action analytics. The next infrastructure priority is the Phase 6 backup/rollback rehearsal.**

What exists:

- Bun/Turborepo monorepo: `apps/web` (Astro SSR + React island), `apps/api`
  (Hono + Better Auth + `pg`), `apps/worker` (background queue runner),
  `packages/ui`, `@workspace/core` (Substack client adapter + ingestion engine),
  `extension` (Chrome MV3 passive capture & companion bridge).
- Paced imports & sync: 3-month cutoff enforced across all streams (`owned_notes`,
  `owned_posts`, `activity`, `outbound_actions`), single-active-import concurrency
  with `POST /imports/:id/cancel` and stop button in UI, and deduped 15-minute
  sync restricted to items in the last 15-minute window.
- Migrations runner (`apps/api/src/migrate.ts`) with `app_migrations` ledger;
  `001_auth.sql` through `007_profile_identity.sql` (full schema with
  tenant RLS, composite foreign keys, per-stream sync/import state, owned-content
  evidence, and separate inbound/outbound engagement calculation).
- D1 Live Data Imported & Reconciled: 692 people, 1,891 interactions, 4 lists, 32 members, 0 quarantined rows.
- Phase 4 Circles UI:
  - Responsive workspace: search, engagement sort, active metric cards ribbon, sync triggers.
  - Views: All, Conversations, Inbound, Outbound, Opportunities, No History.
  - Sidebar: view navigation, list management (create, member counts), tag filters.
  - Interactive Contact Drawer: profile detail, relationship status, private CRM notes with auto-save, list/tag chips.
  - Interaction Timeline: thread conversation grouping, action badges (1/2/3/3 points), Substack external links, cursor pagination.
  - Client-only island mount (`client:only="react"`) bypassing SSR hydration overhead for pure, instant React interactivity.
  - Accessible card triggers and explicit "Details" button with keyboard navigation (`Enter`/`Space`).
  - Base theme: global `cursor: pointer` on all buttons, links, roles, tabs, and interactive elements.
  - URL-addressable navigation (`?view=`, `?sort=`, `?person=`).
- Targeted automated coverage: 34/34 tests passing (19 API/database, 12
  ingestion/worker, 3 extension outbound-capture tests).
- Typecheck: 0 errors across 6 packages (`bun run typecheck`).

---

## Phase 0 — Baseline (complete)

- [x] VPS/Dokploy PostgreSQL service exists; dev tunnel works; DB reachable
- [x] Inventory live D1 schema, row counts, ID formats, malformed data
- [x] Exported live D1 data (`scripts/migration/export-d1.ts`) and imported into PostgreSQL (`scripts/migration/d1-convert.ts`): 692 people, 1,891 interactions, 4 lists, 32 members, 0 quarantined
- [x] Link Better Auth user (`cucoleadan@gmail.com`) to imported `app_users` record
- [x] Capture sanitized Substack fixtures for SDK validation
- [x] Verify pinned `unofficial-substack-sdk` release (0.3.15)
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
- [x] Shared queue pacing for authenticated Substack work; one-item Note/post
      history pages; resumable post offsets; non-terminal exponential 429
      backoff; visible retry state; per-item 404 skips for unavailable historical
      content; migration repair for streams stranded by an earlier failed sibling
- [x] Gate: replays deduplicate; interrupted imports resume; tests passing (26/26)

## Phase 4 — Circles UI (complete 2026-09-17)

- [x] SSR first page + API-paginated subsequent pages (URL-addressable filters/selection)
- [x] Views: Conversations, Inbound, Outbound, No history, Opportunities, All
- [x] Sorts: Highest Engagement (1/2/3/3 rules), Recent Conversation, Recent Activity, Name
- [x] Distinct timestamps: first contact / heard from them / from you / last conversation
- [x] Contact drawer (`ContactDrawer`): edit notes, tags, lists, archive; status selector
- [x] Timeline (`Timeline`): thread grouping, action type badges (like, restack, comment, reply), Substack links, cursor pagination
- [x] Interactive client island (`client:only="react"`) ensuring instant event handling without SSR hydration overhead
- [x] Accessible contact cards & explicit "Details" trigger with keyboard (`Enter`/`Space`) and click support
- [x] Global theme rule: `cursor: pointer` on all buttons, links, `[role="button"]`, select items, tabs, and interactive elements
- [x] Gate: 27/27 tests passing, 0 typecheck errors across all 6 packages, interactive live in dev

## Phase 5 — Extension (complete and verified)

- [x] `/api/ext/companion`, `/api/ext/activity` compatibility routes with user identity
- [x] Thin POST adapters for `/app/settings`, `/app/companion`, `/app/community` (with tag auto-creation)
- [x] Durable `ingestion_batches` ack; dedupe replay via SHA-256 digests; reject other user's queued data
- [x] Modern Circles UI popup: brand concentric circles icon, dark mode zinc theme, real-time connection status with user email, and quick-add to lists/tags
- [x] Concentric circles SVG/PNG icons and favicon created (outer ring, middle ring, center dot)
- [x] Update origin allowlists (`circles.mhntwrkdan.dev`, `localhost:4321`), manifest v3, and packaging
- [x] Gate: add-to-list, capture, reconnect, offline replay verified end-to-end; full Turbo typecheck (0 errors across 6 packages) and API tests passing (17/17)

## Phase 5.5 — Complete interaction history (implemented; live gate pending)

- [x] Build a source/coverage matrix for each interaction type: inbound and outbound
      likes, restacks, restacks with notes, comments, replies, mentions, owned posts,
      and owned notes. Report unsupported historical coverage honestly rather than
      presenting a partial archive as complete.
- [x] Fix counterparty attribution so every confirmed outbound action is attached
      to the person whose post, note, comment, or reply the account acted on; owner
      actions must not be stored with a null person when the target author is known.
- [x] Capture future outbound actions from successful Substack requests in the
      extension, including undo/remove actions, with durable local queueing,
      deterministic IDs, account-generation checks, and replay-safe ingestion.
- [x] Expand the scheduled/manual sync beyond notification activity to include the
      authenticated account's posts, notes, restacks, comments, replies, and any
      upstream outbound-history streams proven to be available. Keep an independent
      cursor/checkpoint and completeness state per stream.
- [x] Add a resumable full-history backfill with start, pause, resume, progress,
      per-stream checkpoints, bounded retries, rate limiting, and explicit finish
      reasons. Seed owned posts/notes and traverse their conversation history without
      relabeling unrelated third-party discussion as a direct interaction.
- [x] Preserve raw evidence needed for reprocessing while normalizing confirmed
      interactions into the existing `interactions` table with direction, action,
      target, thread, counterparty, source, account generation, and event time.
- [ ] Expose outbound history in the CRM: who the account interacted with, action-type
      counts, first/last outbound interaction, conversation context, and filters that
      distinguish engagement received from engagement given.
      Received/given totals, timestamps, timeline context, and inbound/outbound filters
      are complete; a grouped per-action count breakdown is still pending.
- [ ] Gate: incremental sync and backfill deduplicate; interrupted backfills resume;
      unlike/unrestack state is handled; outbound actions never inflate inbound
      engagement scores; representative post and note threads reconcile to source.
      Automated dedupe, attribution, score separation, migration, queue, and API tests
      pass. Live post/Note source reconciliation and a real unlike/unrestack smoke test
      remain before closing the gate.

### Phase 5.5 source coverage matrix

| Interaction/content | Historical backfill | Ongoing coverage | Notes |
| --- | --- | --- | --- |
| Owned Notes | Complete via profile Notes pagination | Scheduled sync | Raw Note payload retained |
| Owned posts | Complete via profile posts | Scheduled sync | Raw post/thread payload retained |
| Comments/replies on owned content | Complete where Substack returns the thread | Scheduled sync | Owner replies attach to the replied-to person; unrelated third-party branches are excluded |
| Inbound likes, mentions, restacks, and quote-restacks | Activity-history dependent | Latest activity sync | Identity is complete only for events retained and returned by Substack |
| Outbound replies/comments on owned content | Recovered from owned thread trees | Thread sync plus extension capture | Counterparty is the parent/root author |
| Outbound replies/comments elsewhere | Paginated authenticated profile replies feed | Latest profile replies page plus extension capture | Each action links to the nearest non-owner parent or target post author by stable profile ID |
| Outbound likes/unlikes | Deep paginated active-Likes feed | Latest Likes page plus extension capture | Removed historical likes may no longer appear upstream; stable IDs let future unlikes remove the captured action |
| Outbound restacks/unrestacks | Paginated active-restacks feed for Notes and posts | Latest restacks page plus extension capture | Removed historical restacks may no longer appear upstream; stable IDs let future unrestacks remove the captured action |
| Individual historical restacker identities on owned content | Activity-history dependent | Activity sync | Note/post aggregate counters do not identify every historical person |

The History panel reports the outbound stream separately. It describes the
authenticated profile feeds as deep active-action history without promising
that Substack retains actions that were later removed.

Reply ingestion accepts Substack's handle-less `user_id` identity shape and creates
or matches contacts by stable profile ID; a public handle is enrichment, not a
prerequisite for preserving the relationship.

Handle-only contacts from older imports are reconciled with later ID-only
contacts when retained evidence proves the exact handle/profile-ID pair. Their
inbound and outbound interactions, lists, tags, and relationship totals converge
on the established handle contact; display-name similarity is never sufficient.

## Phase 6 — Cutover rehearsal

- [x] Full D1 migration completed; inventory and reconciliation completed
- [x] Clerk identity migration retired as no longer required; Better Auth is authoritative
- [x] Scoped import completed; counts reconciled and summaries recomputed
- [ ] Backup restore test; measured read performance vs. targets; rollback rehearsal

## Phase 7 — Release

- [ ] Stop legacy writers; final import; switch ingress; revoke old sessions
- [ ] Enable worker authority; smoke tests; rollback artifacts retained
- [ ] Post-rollback-window: remove Clerk/legacy dependencies

## Test debt (ongoing)

- [ ] Port `tests/community/*`, `user-resolution`, activity tests, extension tests
- [ ] PostgreSQL integration tests (against PG, not SQLite)
- [ ] Required scenarios from plan section 12 as they become implementable
