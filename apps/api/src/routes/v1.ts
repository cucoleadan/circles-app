import { Hono } from "hono"

import { auth } from "../auth.js"
import { getOrCreateAppUser } from "../db/repositories.js"
import { connectionRoutes } from "./v1/connection.js"
import { commentsRoutes } from "./v1/comments.js"
import { importsRoutes } from "./v1/imports.js"
import { listsRoutes } from "./v1/lists.js"
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

v1.route("/", settingsRoutes)
v1.route("/", peopleRoutes)
v1.route("/", commentsRoutes)
v1.route("/", listsRoutes)
v1.route("/", tagsRoutes)
v1.route("/", overviewRoutes)
v1.route("/", connectionRoutes)
v1.route("/", syncRoutes)
v1.route("/", importsRoutes)
v1.route("/", notesRoutes)
