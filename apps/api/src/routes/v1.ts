import { Hono } from "hono"

import { auth } from "../auth.js"
import { getOrCreateAppUser } from "../db/repositories.js"
import { connectionRoutes } from "./v1/connection.js"
import { commentsRoutes } from "./v1/comments.js"
import { importsRoutes } from "./v1/imports.js"
import { listsRoutes } from "./v1/lists.js"
import { newsletterRoutes } from "./v1/newsletter.js"
import { notesRoutes } from "./v1/notes.js"
import { overviewRoutes } from "./v1/overview.js"
import { peopleRoutes } from "./v1/people.js"
import { settingsRoutes } from "./v1/settings.js"
import { syncRoutes } from "./v1/sync.js"
import { tagsRoutes } from "./v1/tags.js"
import type { V1Env } from "./v1/types.js"

export const v1 = new Hono<V1Env>()

v1.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("appUser", await getOrCreateAppUser(session.user.id))
  await next()
})

const operations = new Hono<V1Env>()
operations.route("/", settingsRoutes)
operations.route("/", peopleRoutes)
operations.route("/", commentsRoutes)
operations.route("/", listsRoutes)
operations.route("/", tagsRoutes)
operations.route("/", overviewRoutes)
operations.route("/", connectionRoutes)
operations.route("/", syncRoutes)
operations.route("/", importsRoutes)
operations.route("/", notesRoutes)
v1.route("/", operations)
// Browser-only: subscriber emails are never exposed to MCP operations.
v1.route("/", newsletterRoutes)

/** In-process operations for an already authenticated caller; never mounted publicly. */
export function tenantOperations(appUser: string, mcpScopes?: ReadonlySet<string>, draftOnly = false) {
  const scoped = new Hono<V1Env>()
  scoped.use("*", async (c, next) => {
    c.set("appUser", appUser)
    c.set("mcpScopes", mcpScopes)
    c.set("mcpDraftOnly", draftOnly)
    await next()
  })
  scoped.onError(() => new Response(JSON.stringify({ error: "The operation failed" }), {
    status: 500, headers: { "content-type": "application/json" },
  }))
  scoped.route("/", operations)
  return scoped
}
