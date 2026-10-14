# Circles CRM rebuild — progress tracker

Tracks implementation against `circles-crm-vps-rebuild.md` (phases in section 10).
Update this file as work completes. Last updated: 2026-10-14.

## 2026-10-14 MCP implementation (not deployed)

- [x] Repository-grounded implementation plan in `plans/circles-mcp.md`: shared
      Better Auth sign-in with Cloudflare Access OIDC integration, remote MCP
      client compatibility, daily briefing, and phased full app operations.
- [x] Expanded the plan to include the SDK MCP's complete toolset; local
      network-free discovery confirms 18 read capabilities and 36 registered
      names/aliases. Plan covers reuse, live-read pacing, and sensitive-data grants.
- [x] Implemented stateless `/api/mcp`, all 36 SDK names/aliases and 57 Circles
      tools, typed schemas and per-tool permissions. REST delegation reuses
      existing Note/CRM validation and queue behavior.
- [x] Added shared Better Auth OAuth login, signed consent, token/DPoP checks,
      browser grant revocation, `/mcp` management and optional explicitly linked
      Cloudflare Access OIDC. Better Auth is pinned to 1.7.7.
- [x] Added forward-only migrations `033`/`034`, private SDK run storage/RLS,
      worker queue integration, pacing, raw-record gates and credential redaction.
- [x] Added daily briefing, DST-aware day boundaries, SDK schema/alias parity,
      permission, OAuth, tenant and worker tests.
- [x] Fixed audit findings: serialize/drain SDK requests before releasing the
      database client, compare Note times numerically, and lock SDK admission
      by tenant. Added regression cases for serialization, offset ranges,
      concurrent clients, refresh rotation and DPoP replay/key rejection.
- [x] Before the user's verification restriction: protocol/schema checks passed;
      fresh/test DB migrations `033`/`034` applied; shared-session PKCE/revocation
      and tenant-safe MCP writes passed. No production schema was changed.
- [ ] Run the new audit regression cases, corrected SDK worker fixture and full regression suite when
      authorized. User subsequently requested only typecheck/check; runtime
      tests were stopped and the temporary database tunnel closed.
- [ ] Verify modern-client/gateway integration and actual Cloudflare SSO linking.
- [ ] Deploy migrations and update production `/.well-known/*` routing.

No build, deployment, push or extension rebuild. `npm run check` does not exist;
the repository typecheck includes the web's `astro check`.

## 2026-10-12 Unified comments

- [x] Comments view lists synced comments and direct replies received on owned
      Notes/articles, with authors, per-comment Replied/Liked badges and reversible
      Not interested choices (migration `032`).
- [x] Top-level Exclude liked/replied toggle filters before pagination and combines
      with the status/content filters. Content titles and Open Note/article on
      Substack buttons open the source in a new tab; missing Note URLs use the
      existing profile-handle permalink helper.
- [x] Comments default to the preceding 48 hours. A date-range picker reuses the
      existing shadcn Calendar/Popover and includes whole local calendar days;
      Last 48 hours resets the selection. API dates are validated and filtered
      before pagination, with the same 48-hour default for direct requests.
- [x] Regression coverage added for response exclusion, pagination, removed Likes,
      duplicate comments, tenant isolation, request validation and source links,
      plus date boundaries, historical selection and the rolling 48-hour default.
- [x] Typecheck and diff whitespace checks pass for the follow-up.
- [ ] Run database tests and visually verify the view. Per user instruction,
      no services, tunnels or builds were started for this follow-up.
- [ ] Deploy migration `032`; older unrecorded outbound actions remain unknown.

## 2026-10-02 Note tags and restack previews

- [x] Note tags: a Circles-only tag catalog (migration `030`) with create,
      rename, recolor and delete in a Manage tags dialog. Tags can be set
      from the composer, queue cards and a Table column, on any Note
      (including published ones), and a Tags filter narrows all three views.
- [x] Outbound restacks/Likes of posts show a Substack-style preview card
      (cover image, title, subtitle, author and publication) in the contact
      timeline; Note targets show a linked snippet. Extension captures no
      longer store the feed page as the target URL; `getPost` supplies the
      real URL and cover. Migration `031` replays retained profile-feed
      evidence to fill previews for past actions.
- [x] Typecheck and the full test suite pass (103 tests). Build not run.
- [ ] Deploy migrations `030`/`031`. Until then a local API pointed at the
      production DB fails Note list requests (`scheduled_note_tags` missing).
- [ ] Older extension-captured restacks outside retained profile-feed
      evidence keep no preview image.

## 2026-10-02 Note scheduling

- [x] `/notes` page (Queue, Calendar and Table views) to write, schedule,
      draft, post now (60 s delay with Abort), edit, reschedule and delete
      Notes, with CRM @-mentions and image/link attachments. Built on
      `unofficial-substack-sdk` 0.4.0; Substack publishes scheduled drafts
      itself. Design and SDK facts: `plans/note-scheduling.md`.
- [x] Migration `029` mirrors the account's Note drafts (including those made
      in Substack's app) and adds throttled draft reconciliation.
- [x] Core and API tests, typecheck, build, and a mocked UI check pass.
- [ ] Deploy migration `029` and run the live smoke test in the plan
      (schedule, reschedule, publish, Post now + Abort, delete).

## 2026-09-30 recent sync progress

- [x] The Sync button opens a side panel and starts a manual sync. The panel
      polls tenant-scoped queue progress every three seconds and shows the
      activity page, Notes/posts, outbound actions, and audience steps.
- [x] Worker jobs retain safe processed/new counts in migration `026`; the
      progress API omits raw job payloads and private error details.
- [x] Future scheduled activity jobs no longer prevent a manual sync from
      being queued.
- [ ] Deploy migration `026` and verify a live sync runs through the panel.

## 2026-09-30 contact overview cleanup

- [x] Attach a Substack profile link to the score pill on every contact card
      when the contact has a usable profile URL or handle. Opening it does not
      open the CRM contact drawer.
- [x] Link the displayed @handle to the same Substack profile on contact cards
      and in the contact drawer; the details tab handle is linked as well.
- [x] Reduce card clutter by showing received/given and conversation counts,
      plus one labeled last-engagement date and direction in place of two
      separate timestamps. Typecheck and build pass.
- [ ] Deploy and visually verify the card layout with live contact data.

## 2026-09-29 extension capture identity failure

- [x] Diagnosed repeated extension capture failures as handle-only authors failing
      to match an existing contact that already had a stable Substack profile ID.
      The ignored unique-handle insert then returned a phantom person ID and the
      interaction failed its foreign-key constraint.
- [x] Allow handle-only evidence to reuse an existing stable-ID contact, require
      person inserts to return a real row before using their ID, and preserve the
      original capture error through a transaction savepoint.
- [x] Added regression coverage; core/worker tests, API/database tests, typecheck,
      and the production build pass.
- [ ] Deploy and verify the extension's retained capture queue drains without new
      `interactions_person_id_fkey` errors. No extension package rebuild is needed.

## 2026-09-25 audience 403 retries

- [x] Cap follower and following job retries after Substack 403 responses at
      the job's configured attempt limit (five by default). Exhausted jobs move
      to dead letter and their import stream is marked failed when applicable.
- [ ] Deploy and verify that the repeatedly failing follower job stops retrying.

## 2026-09-24 activity sync failure

- [x] Diagnosed repeated `sync:activity` failures: activity ingestion emits
      `follow`, but the `interactions.action_type` check constraint omitted it.
- [x] Added migration `024` to allow follow interactions and queue an activity
      sync for active connections left without a pending or running job.
- [x] Deployment applied migration `024` at 2026-09-24 07:16 UTC. Activity sync
      succeeded for both active connections and queued their three-hour
      successors.
- [x] Ran activity-only backfills across both missed intervals through the
      normal import queue. Both completed in one page; one recovered 17
      interactions, and the other found no additional interactions.

## 2026-09-24 list count mismatch

- [x] Found BIG FISH had two membership rows, but one contact was archived.
      The people grid excludes archived contacts while list counts included them.
- [x] Verified the archived `@griffingooch` row was misnamed Will Parker
      Anderson: the public Substack profile belongs to Griffin Gooch. Migration
      `009` ran before these rows existed; migration `016` excluded the archived
      row and, correctly, had no stable-ID or avatar evidence to merge it with
      `@willparkeranderson`. Keep these identities separate.
- [x] Corrected the archived Griffin row's name and added verified stable
      profile IDs to it and the active Will row in production. Archive state and
      list memberships were preserved and the corrections were audited.
- [x] Updated list counts to match visible contacts, including Ignored-list
      isolation. The database test passes.
- [x] Added profile-link confirmation to contact creation and the extension's
      list modal, and strengthened author parsing to prefer a name linked to
      the same handle over avatar alt text. This adds no Substack reads.
- [ ] Deploy and verify the corrected BIG FISH count in production; install
      companion version 0.2.7 to use the new extension confirmation flow.

## 2026-09-24 missing contact profile links

- [x] Verified Mariam Vossough's public `@mariamvossough` profile and filled
      her missing `profile_url` in production with a guarded, audited update.
- [x] Added a drawer/details fallback for valid stored handles and repaired
      canonical ingestion so existing matching contacts acquire a missing URL.
- [x] Added migration `025` to backfill missing links from valid normalized
      handles without fetching profiles or changing contact identities.
- [ ] Deploy migration `025` and verify the remaining missing-link count.

## 2026-09-24 contact refetch

- [x] Added a contact drawer Refetch action backed by a tenant-scoped queued job.
      It refreshes the public profile image, newest activity page, and up to
      three newest outbound feed pages through canonical ingestion. The job makes
      at most five SDK calls, has one attempt even on 429/403, deduplicates
      concurrent clicks, and applies a ten-minute success cooldown.
- [x] The drawer reloads contact details and timeline and shows a success toast
      after the job completes; failures show an error toast.
- [ ] Deploy and verify against a live contact. This refetch covers recent pages,
      not a full historical backfill.

## 2026-10-01 backend reliability pass

- [x] Recurring sync self-heals: migration `027` adds
      `seed_missing_activity_syncs()`, called by worker maintenance every 5
      minutes; connecting schedules the first sync; `sync:activity` never
      dead-letters except on session expiry and backs off up to 30 minutes.
- [x] Activity sync pages back to the last successful sync (30-minute overlap,
      max 5 pages) with no `created_at` filter; migration `027` queues an
      evidence replay to recover grouped-notification likers and overflow
      items dropped by the old filter.
- [x] Scheduled reply refresh covers the 6 newest Notes (7 days) and 3 newest
      posts (14 days); outbound pages use a 24-hour window.
- [x] Connect verifies the Substack session first and keeps the working
      connection when verification fails (extension, web, and CLI paths share
      `replaceSubstackConnection`).
- [x] 30-second fetch timeout for all outbound requests; API/worker pools have
      connection, statement, and idle-in-transaction timeouts; the extension
      capture route resolves targets outside its transaction and caps bodies at
      2 MB and conversation trees at 2,000 comments.
- [x] Follow-up jobs commit atomically with job completion under the lease;
      expired leases count as attempts; only a 401 expires a connection;
      Cloudflare 403s on sync/import work back off like rate limits.
- [x] Drift status is derived from `last_interaction_at` at read time;
      timestamp-less captures no longer move interactions to "now"; id-less
      captures get a stable content hash; stats refresh and subscriber upserts
      run in batches; one canonical `refreshPersonStats` in core.
- [x] Done jobs older than 14 days and dead jobs older than 30 days are pruned.
- [x] Optional `SESSION_TOKEN_KEY` encrypts Substack session tokens at rest.
- [x] Deployed `027` (2026-10-01 12:41 UTC): incremental subscriber sync used
      2 requests (Substack returns subscribers oldest-first) and activity sync
      read 2 pages. The evidence replay hit `interactions_active_action_target_idx`
      on a Like soft-removed by migration `011`; ingestion now keeps such
      duplicates removed and migration `028` re-queues the replay.
- [ ] Deploy `028` and confirm the evidence replay finishes without errors.
- [ ] Optionally set `SESSION_TOKEN_KEY` in Dokploy for api and worker, then
      reconnect Substack to encrypt the stored session.
- [ ] Scheduled owned Notes/posts history still fetches reply trees inside a DB
      transaction (bounded by the fetch timeout); split fetch/ingest if needed.

## 2026-09-23 sync incident

- [x] Diagnosed the stopped recurring sync: `sync:activity` dedupe matched its
      own running job, so no successor was queued. The last activity sync was
      2026-09-22 09:15 UTC; the queue had no pending or running jobs.
- [x] Excluded the current job from that dedupe and added migration `021` to
      seed activity jobs for active connections on the next deployment.
- [x] Deployed migration `021` and verified activity jobs leave successors due
      three hours later. The next live run was queued for 2026-09-23 10:48 UTC.

## 2026-09-23 subscriber and handle repair

- [x] Removed name/avatar subscriber matching when Substack supplies a stable
      profile ID. Canonical interaction ingestion now follows the same rule,
      and follower/relationship handle matches cannot override a different
      stable ID.
- [x] Restored subscriber refresh to each scheduled activity sync. Extension
      capture retries now deduplicate before optional Substack target lookups.
- [x] Added migration `022` for a paced handle repair pass. Authentication and
      rate-limit errors retain the job for retry instead of silently advancing.
- [x] Verified the linked contact in the current subscriber response and
      corrected its live subscriber flag. Recovered 16 live handles using exact
      Substack profile IDs or retained interaction evidence. No proven duplicate
      contacts were found among these, so no people were merged.
- [x] Deployed migration `022`; a live subscriber sweep processed 552 records,
      matched 552, skipped none, and corrected the linked contact. The handle
      repair is queued and progressing separately.
- [ ] Verify the handle repair after it finishes. Substack profile lookup
      returns 404 for many handle-less subscriber IDs; those contacts must
      remain handle-less unless new identity evidence appears.
- [x] Following sweeps now import missing followed profiles by stable ID before
      reconciling outbound follow/subscription flags. Migration `023` schedules
      one immediate post-deploy sweep.
- [ ] Deploy and verify the 92 upstream followed profiles against the CRM; 68
      existing contacts were marked following before this fix.

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
  sync restricted to items in the last 15-minute window. Each scheduled sync
  also queues a subscriber refresh and one paced follower-status batch. The
  subscriber refresh is incremental (newest subscribers back to the newest
  stored subscription minus one day, at most 10 pages, no unsubscribe
  reconciliation) unless no full sweep finished for that connection in the last
  23 hours, in which case it runs the full reconciling sweep that marks
  unsubscribes. Scheduled subscriber pages are spaced 30 seconds apart, and
  full-sweep pages overlap by 10 records so a mid-sweep unsubscribe cannot
  shift another subscriber out of the snapshot. Manual subscriber syncs and
  imports always run the full sweep at the 2-second pace.
- Migrations runner (`apps/api/src/migrate.ts`) with `app_migrations` ledger;
  `001_auth.sql` through `007_profile_identity.sql` (full schema with
  tenant RLS, composite foreign keys, per-stream sync/import state, owned-content
  evidence, and separate inbound/outbound engagement calculation).
- D1 Live Data Imported & Reconciled: 692 people, 1,891 interactions, 4 lists, 32 members, 0 quarantined rows.
- Phase 4 Circles UI:
  - Responsive workspace: search, engagement sort, active metric cards ribbon, sync triggers.
  - Views & Queues: All, Needs Your Reply, Ball in Their Court (with 7-day cutoff), Priority to Engage, Mutual Circle, Conversations, Inbound, Outbound, Opportunities, No History.
  - Priority to Engage queue with user-customizable adaptive thresholds (unreciprocated supporters, recent restackers, drifting advocates).
  - User Settings (`app_users.settings` JSONB column via Migration `012_user_settings.sql`) and slide-over Settings UI for customizing queue criteria and scoring parameters.
  - Migration `013_people_avatar_url.sql`: `avatar_url` column added to `people` table with backfill from retained `profile_snapshots`, ingestion pipeline population, and worker enrichment.
- Contact profile pictures: Rendered cleanly across Contact Cards and Contact Drawer using `referrerPolicy="no-referrer"` to safely bypass Substack CDN anti-hotlinking.
- Extension Companion Substack Parser Hardening: Fixed author extraction bug on restacked Notes where decoupled DOM queries paired the restacker's name with the original author's handle; introduced candidate grouping in `author-parser.ts` that strictly binds handle and display name, penalizes restack banners, prioritizes the specific author header row containing the "+ Circles" button, and eliminates cross-wiring.
- Extension Distribution: Circles Companion published on Chrome Web Store with direct 1-click install link and guide in Settings Dialog; `circles-companion-0.2.6.zip` preserved for Developer Mode manual install.
- Ignored List & Action Filtering: Contacts in the "Ignored" list are dynamically excluded from Action Queues (`priority`, `needs-reply`, `awaiting-response`, `mutual`); distinct 🚫 styling in sidebar and cards; quick Ignore/Unignore toggle button in contact drawer header; action queues can be filtered by any custom list.
- "Needs Your Reply" Logic Refined: Excludes contacts where user liked last or liked after the latest inbound comment (conversation acknowledged).
- Profile Restacks Filter: Profile breakdown and timeline feature always-visible restack filter chips and reciprocal engagement counts.
- Recency Drift Clarification: Replaced ambiguous stage statuses with user-defined Lists and clarified the "Active" status as an objective 30-day interaction recency drift indicator.
- Inline List Creation: Allows creating and immediately assigning new lists directly from the contact drawer's Notes & Memberships tab.
- Advanced Filters & Bi-directional Sorting: Filter contacts by interaction type (restacks, comments, likes); sort by newest/oldest activity by them (inbound) or by me (outbound), as well as lowest/highest engagement.
- Profile Card & Mobile View Enhancements: List badges displayed prominently under contact name/handle with high-contrast pills; dual engagement timestamps ("By them" and "By me") with relative time formatting; responsive mobile layout with quick queue navigation strip, slide-over navigation drawer, 2-column mobile toolbar filters, and overflow-free navbar.
- List Management & Safe Deletion: Dedicated Contact Lists settings panel in Settings Dialog and sidebar shortcut for creating, searching, renaming, and safely deleting lists. Deleting a list unlinks contact memberships via PostgreSQL cascade while strictly preserving contacts and interaction histories; includes an explicit confirmation modal and reactive state updates across sidebar, contacts, and active filters. Direct URL routing supported via `/settings?tab=lists` and `?settings=lists`.
- Settings Slide-In Menu & 2x2 Grid: Replaced overflowing single-row tab bar in `SettingsDialog` with a sleek 2x2 responsive grid (`Connection`, `Queue`, `Lists`, `Extension`) that eliminates text truncation and visual clipping across all viewport widths.
- UI Component Decomposition (≤ 350 Lines): Decomposed all frontend components exceeding 350 lines (`settings-dialog.tsx`, `circles-workspace.tsx`, `contact-details-tab.tsx`, `circles-sidebar.tsx`, `contact-card.tsx`, `contact-drawer.tsx`, `timeline.tsx`) into modular, single-responsibility subcomponents, ensuring 100% of files in `apps/web/src` are ≤ 350 lines.
- Contact Profile Editing from Detailed View: Added comprehensive profile editing directly from the Contact Drawer and Notes & Memberships tab (`EditContactDialog`). Allows users to update full name, add/update Substack handles (including quick `+ Add handle` shortcut for contacts missing a handle), live-preview avatar URLs, Substack profile URLs, publication URLs, Substack profile IDs, and relationship statuses without modifying interaction histories or engagement scores. API validates handle uniqueness and prevents collisions.
- Duplicate Contact Merging (Migration `016_merge_avatar_and_name_duplicate_contacts.sql`): Merged duplicate contacts sharing identical names and custom avatar URLs (e.g. Dipankar Sarkar), transferring all 12 interactions, re-linking list memberships and tags, recalculating relationship stats, and archiving duplicate profiles. Core ingestion deduplication updated to safely match existing contacts by normalized name and custom avatar URL, preventing future duplicates.
- Audience Data Layer (Migrations `015_people_followers_subscribers.sql` through `020_relationship_directions_and_handle_backfill.sql`): Inbound followers/subscribers and outbound following/subscriptions are stored and displayed independently. The unified History & Sync panel can run current subscriber, follower, following/subscription, and stable-ID handle-repair sweeps beside the four historical streams. Each 15-minute sync refreshes all three current audience sources. Temporary follower-list 403s are paced and retried, and contacts without either a handle or stable profile ID are reported honestly instead of matched by name.
- Complete Audience Import: Subscriber and follower sweeps both create missing CRM contacts from stable Substack profile IDs, deduplicate against existing profile IDs/handles, and reconcile current membership flags after a complete snapshot.
- "Follows · Not Subscribed" View: Dedicated directory view and sidebar navigation item with count badge displaying contacts who follow on Substack Notes/profile but have not subscribed to the publication. Visual badges (`Follows · No Sub`, `Subscriber`, `Follower`) rendered on contact cards and contact drawer.
- App-Wide Ignored Contact Isolation: Contacts in the "Ignored" list are now completely excluded from all CRM views, counts, and queries across the app, appearing exclusively in a dedicated "Ignored" directory tab.
- Configurable History Backfill Timeframes: Added flexible timeframe presets (1 week, 2 weeks, 1 month, 2 months, 3 months) and a custom date picker in `HistoryBackfill` sheet (`POST /api/v1/imports` accepts `days`, `months`, or `cutoffDate`). Added publication audience sync controls directly inside the history sheet.
  - Interactive Contact Drawer: profile detail, relationship status, private CRM notes with auto-save, list/tag chips.
  - Interaction Timeline: thread conversation grouping, action badges (1/2/3/3 points), exact target excerpts for Likes, honest unavailable-content fallbacks, Substack external links, cursor pagination.
  - Client-only island mount (`client:only="react"`) bypassing SSR hydration overhead for pure, instant React interactivity.
  - Accessible card triggers and explicit "Details" button with keyboard navigation (`Enter`/`Space`).
  - Base theme: global `cursor: pointer` on all buttons, links, roles, tabs, and interactive elements.
  - URL-addressable navigation (`?view=`, `?sort=`, `?person=`).
- Targeted automated coverage: 36/36 tests passing (22 API/database, 11
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
      Like timelines now preserve and display the acted-on Note/comment/post content;
      retained evidence is replayed after migration and proven duplicate active actions
      are soft-removed across import/connection boundaries.
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
