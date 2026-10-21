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
  `plain` rows keep working and are re-encrypted by the worker on the
  connection's next activity sync (no reconnect needed). Once
  any connection is encrypted the key must stay configured and unchanged, or
  that connection can no longer sync until it is reconnected.
- `EXTENSION_STORE_URL` (web) — overrides the public Circles Companion
  Chrome Web Store link shown in Settings.
- `CONTACT_EMAIL` (web) — contact address shown on `/privacy`.

Queue self-healing: every 5 minutes the worker calls
`seed_missing_activity_syncs()` (migration `027`, `SECURITY DEFINER` owned by
`circles_migrate`), which queues a `sync:activity` job for any active
connection without a pending or running one, and prunes `done` jobs older than
14 days and `dead` jobs older than 30 days.

Row level security: every tenant table is protected by a policy comparing
`user_id` with `app_tenant_id()` (`current_setting('app.user_id')`). The API
sets that value transaction-locally (`withTenant` in `apps/api/src/db/tenant.ts`)
so context never leaks between requests. `circles_migrate` owns the tables and
bypasses RLS; only migration tooling may use it.

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
   - A cross-origin `POST /api/v1/people` with a foreign `Origin` header is
     rejected with 403.
   - PostgreSQL is reachable only from the private network (no public
     port/host binding).
3. Restart the stack (`docker compose restart`) and confirm data persists and
   services come back healthy.

## Backups

Dokploy has no backup destination configured, so it takes no database
backups. The compose `backup` service (`postgres:18-alpine`, same major as the
server) writes `pg_dump --format=custom` files to the `backups` volume as
`/backups/circles-<UTC timestamp>.dump`. It checks hourly, dumps when the
newest file is over 23 hours old and deletes dumps older than
`BACKUP_KEEP_DAYS` (default 14). A dump is ~490 MB for a ~1.3 GB database.
It connects with the admin `DATABASE_URL` (superuser), so dumps include every
tenant's rows despite RLS. Check it with `docker logs <app>-backup-1`.

These dumps live on the same host as the database: they cover mistakes and
corruption, not losing the server. Copy them off the host, or add a Dokploy S3
destination, for disaster recovery.

### Restore drill (tested 2026-10-21)

Run inside the backup container, which has the client tools, the network and
the admin URL:

```sh
docker exec -it <app>-backup-1 sh
base="${DATABASE_URL%/*}"            # the URL must not carry ?query params
file=$(ls -t /backups/circles-*.dump | head -1)
psql "$DATABASE_URL" -c "create database circles_restore_check"
pg_restore --no-owner --no-privileges --jobs=2 --exit-on-error   -d "$base/circles_restore_check" "$file"
psql -tA "$base/circles_restore_check" -c "select max(name) from app_migrations"
psql "$DATABASE_URL" -c "drop database circles_restore_check"
```

The drill restored a 486 MB dump in 101 s; row counts matched the live
database apart from rows synced after the dump, and all 26 RLS tables kept RLS.
`--no-owner --no-privileges` suits a scratch copy. To replace the real
database, stop `api`/`worker`, restore with owners and privileges kept (the
roles already exist in the cluster), then start them again.

### Read performance (measured 2026-10-21 on the restored copy)

Medians of three warm runs through the app role with RLS, over an SSH tunnel
with an ~8 ms round trip, for a 9.4k-contact and a 1.3k-contact account:
overview 180/90 ms, people list (1,000) 229/70 ms, priority 211/81 ms,
needs-reply 160/57 ms, following 42/50 ms, search 92/59 ms. Pending comments
took 715/43 ms because the query ranked every inbound comment before applying
its window. Windows up to 31 days now pre-select comments with a row in the
window, which cut the live 48-hour view from ~450-510 ms to ~110-140 ms with
identical results; longer history ranges are unchanged (~510 ms).
