import { betterAuth } from "better-auth"

import { db } from "./db.js"

const publicUrl = process.env.APP_URL ?? "http://localhost:4321"

export const auth = betterAuth({
  appName: "Circles",
  baseURL: publicUrl,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: db,
  trustedOrigins: [publicUrl],
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.ALLOW_SIGNUP !== "true",
  },
})
