# Circles CRM

Minimal Bun monorepo for the Circles CRM rebuild.

- `apps/web`: Astro SSR and React/shadcn UI
- `apps/api`: Hono API, Better Auth, migrations, PostgreSQL
- `apps/worker`: background jobs
- `packages/ui`: shared generated UI components
- `packages/core`: shared domain code when needed

## Local development

Copy `.env.example` to `.env`, then run `bun install`, `bun --cwd apps/api run dev`, and `bun --cwd apps/web run dev`.

## Deployment

Dokploy builds `compose.yaml`. Route the public domain to `web:4321` and the same domain with path `/api` to `api:3000`.
