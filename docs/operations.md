# Operations runbook

Operational procedures for the Circles CRM stack. Deployment target is a
Dokploy host on a private VPS; public ingress is a **Cloudflare Tunnel**
(not Dokploy's Traefik domains).

## Services and roles

Docker Compose units: `migrate` (one-shot, gated), `api` (Hono + Better Auth),
`worker` (background jobs), `web` (Astro SSR). PostgreSQL runs as a separate
Dokploy database service on the `dokploy-network` and is never exposed
publicly.

Database roles (created/refreshed automatically by the `migrate` service on
every deploy, using the admin `DATABASE_URL`):

| Role | Used by | Privileges |
|---|---|---|
| admin (Dokploy `DATABASE_URL`) | `migrate` bootstrap only | Owner/superuser; creates roles, transfers ownership |
| `circles_migrate` | `migrate` SQL execution | Owns the `public` schema objects; can create/alter tables |
| `circles_app` | `api`, `worker` | DML only (`SELECT/INSERT/UPDATE/DELETE`); no DDL |

The `api` and `worker` connect through the dedicated `APP_DATABASE_URL`
connection string (role `circles_app`). They never see the admin
`DATABASE_URL`. In production (`NODE_ENV=production`) services refuse to start
without it. Locally, `scripts/dev.ts` injects the same variable for the tunnel.

Required Dokploy environment variables for the compose application:

- `DATABASE_URL` — the Dokploy database service connection string (admin;
  used by the `migrate` service only)
- `APP_DATABASE_URL` — runtime connection string as `circles_app`
- `APP_DB_PASSWORD` — password for the `circles_app` runtime role (migrate bootstrap)
- `MIGRATE_DB_PASSWORD` — password for the `circles_migrate` role
- `APP_URL` — canonical public URL (e.g. `https://circles.example.com`)
- `BETTER_AUTH_SECRET` — high-entropy secret (32+ random bytes)
- `ALLOW_SIGNUP` — `false` after the initial account exists

Optional:

- `SESSION_TOKEN_KEY` — 32 random bytes, base64 (`openssl rand -base64 32`).
  When set on both `api` and `worker`, Substack session tokens saved from then
  on are encrypted at rest (AES-256-GCM, `key_id = 'env-v1'`). Existing
  `plain` rows keep working and become encrypted on the next reconnect. Once
  any connection is encrypted the key must stay configured and unchanged, or
  that connection can no longer sync until it is reconnected.

Queue self-healing: every 5 minutes the worker calls
`seed_missing_activity_syncs()` (migration `027`, `SECURITY DEFINER` owned by
`circles_migrate`), which queues a `sync:activity` job for any active
connection without a pending or running one, and prunes `done` jobs older than
14 days and `dead` jobs older than 30 days.

Row level security: every tenant table is protected by a policy comparing
`user_id` with `app_tenant_id()` (`current_setting('app.user_id')`). The API
sets that value transaction-locally (`withTenant` in `apps/api/src/db/tenant.ts`)
so context never leaks between requests. `circles_migrate` owns the tables and
bypasses RLS, which the D1 import relies on; only migration tooling may use it.

## D1 import (Phase 2 converter)

From the `stackedhq-app` checkout with `wrangler` authenticated:

```bash
DATABASE=stackedhq-app-db OUT=../circles-app/scripts/migration/exports \
  ../circles-app/scripts/migration/d1-export.sh
```

Then, from `circles-app` with the dev tunnel up:

```bash
bun --env-file=.env scripts/migration/d1-convert.ts --dir=scripts/migration/exports
```

The converter imports in dependency order as `circles_migrate`, writes
`exports/report.json` (per-table source/imported/quarantined/flagged counts)
and `exports/quarantine.json` (rows that cannot be converted losslessly, with
reasons). Invalid required timestamps quarantine the row; invalid JSON
metadata is imported empty and flagged. `community_engagements` land in a
separate `legacy_engagements` table with provenance — never merged into
`interactions` without proven identity. Import runs land as `import_runs`
with leases cleared and `running` mapped to `paused`.
For a dry run against a throwaway database, add `--database=circles_test`.
Fixture files under `scripts/migration/fixtures/` demo the quarantine paths.

## Cloudflare Tunnel routing

The tunnel must route a single public hostname to both services:

```yaml
ingress:
  - hostname: circles.example.com
    path: ^/(api/.*|\.well-known/.*)$
    service: http://api:3000
  - hostname: circles.example.com
    service: http://web:4321
  - service: http_status:404
```

`cloudflared` must be attached to the same Docker network as the application
(`dokploy-network`) so the container names resolve. Do not publish the
`api`/`web` ports on the host.

MCP discovery needs the `/.well-known/*` rule above as well as `/api/mcp`.
The web middleware also forwards GET/HEAD `/.well-known/*` to
`API_INTERNAL_URL`, so discovery works when an existing tunnel sends those
paths to the web service. It forwards public metadata without browser cookies.
See `docs/mcp.md` for OAuth, Cloudflare portal, scoped tools, and optional Access
SSO configuration. API and worker both need the same canonical `APP_URL`.

## Admin password reset (no email provider)

Better Auth email/password is the only sign-in method and there is no
transactional email yet, so recovery is an administrator-run procedure:

On the VPS, from the directory where Dokploy checked out the application (or
anywhere the compose project is available):

```sh
docker compose run --rm migrate bun apps/api/dist/reset-password.js \
  user@example.com 'new-password'
```

This sets the new password hash on the user's credential account and revokes
all of their sessions. The user then signs in with the new password.

During local development with the SSH database tunnel active:

```sh
DATABASE_URL=postgresql://...tunnel-url... bun --cwd apps/api run reset-password \
  user@example.com 'new-password'
```

Generate one-off passwords (`openssl rand -base64 18`) and share them over a
private channel; rotate them after first sign-in when practical.

## Deployment and smoke test

1. Push to the git remote Dokploy builds from; wait for the build and for the
   `migrate` service to complete and `api` to become healthy.
2. Verify through the public URL:
   - `/login` renders and sign-in works through the tunnel (cookie is set for
     the public hostname only).
   - Circles overview SSR-loads contacts (SSR→API cookie forwarding works).
   - `/api/ready` returns `{"status":"ready"}` and responses carry
     `Cache-Control: no-store`.
   - A cross-origin `POST /api/contacts` with a foreign `Origin` header is
     rejected with 403.
   - PostgreSQL is reachable only from the private network (no public
     port/host binding).
3. Restart the stack (`docker compose restart`) and confirm data persists and
   services come back healthy (Phase 1 gate: fresh setup and restart work).

## Backups

Dokploy's scheduled PostgreSQL backups are the interim mechanism; the full
off-site encrypted backup/restore policy with tested restores is a Phase 6
deliverable. Until then, treat backups as unproven.
