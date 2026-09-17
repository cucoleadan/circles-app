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

The `api` and `worker` connect as `circles_app` by swapping the role and
password (`APP_DB_PASSWORD`) into the admin URL at runtime. In production
(`NODE_ENV=production`) services refuse to start without `APP_DB_PASSWORD`.
Locally, development runs against the admin URL for convenience.

Required Dokploy environment variables for the compose application:

- `DATABASE_URL` — the Dokploy database service connection string (admin)
- `APP_DB_PASSWORD` — password for the `circles_app` runtime role
- `MIGRATE_DB_PASSWORD` — password for the `circles_migrate` role
- `APP_URL` — canonical public URL (e.g. `https://circles.example.com`)
- `BETTER_AUTH_SECRET` — high-entropy secret (32+ random bytes)
- `ALLOW_SIGNUP` — `false` after the initial account exists

Known tradeoff ( revisit in Phase 2): `api`/`worker` still receive the admin
`DATABASE_URL` string in their environment so they can derive the runtime
connection. A dedicated `APP_DATABASE_URL` variable would remove the admin
credentials from the app services entirely.

## Cloudflare Tunnel routing

The tunnel must route a single public hostname to both services:

```yaml
ingress:
  - hostname: circles.example.com
    path: ^/api/.*
    service: http://api:3000
  - hostname: circles.example.com
    service: http://web:4321
  - service: http_status:404
```

`cloudflared` must be attached to the same Docker network as the application
(`dokploy-network`) so the container names resolve. Do not publish the
`api`/`web` ports on the host.

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
