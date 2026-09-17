# Circles CRM

Minimal Bun monorepo for the Circles CRM rebuild.

- `apps/web`: Astro SSR and React/shadcn UI
- `apps/api`: Hono API, Better Auth, migrations, PostgreSQL
- `apps/worker`: background jobs
- `packages/ui`: shared generated UI components
- `packages/core`: shared domain code when needed

## Local development

`bun run dev` opens the SSH tunnel to the private Dokploy PostgreSQL and
starts the API, worker, and web app. `bun run dev:check` only verifies the
database connection.

## Deployment

Dokploy builds `compose.yaml` from the git remote. Public ingress is a
Cloudflare Tunnel: route the hostname's `/api/*` paths to `api:3000` and
everything else to `web:4321` on the shared Docker network. See
`docs/operations.md` for the tunnel config, required environment variables,
database roles, password recovery, and the post-deploy smoke test.
