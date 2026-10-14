import { betterAuth } from "better-auth"
import { createAuthEndpoint, APIError } from "better-auth/api"
import { genericOAuth, jwt } from "better-auth/plugins"
import { mcp } from "@better-auth/mcp"
import { cimd } from "@better-auth/cimd"
import { fetchClientMetadataResource } from "@better-auth/cimd/node"
import { getOAuthProviderApi, type OAuthOptions } from "@better-auth/oauth-provider"
import { z } from "zod"
import { createDpopReplayStore, enforceDpopBinding, parseAccessTokenAuthorization } from "better-auth/oauth2"

import { db } from "./db.js"
import { MCP_SCOPES } from "./mcp/scopes.js"

const publicUrl = process.env.APP_URL ?? "http://localhost:4321"
export const mcpResource = `${publicUrl.replace(/\/$/, "")}/api/mcp`
export const oauthOptions = {
  loginPage: "/login",
  consentPage: "/mcp/consent",
  scopes: ["offline_access", ...MCP_SCOPES],
  grantTypes: ["authorization_code", "refresh_token"],
  accessTokenExpiresIn: 15 * 60,
  refreshTokenExpiresIn: 30 * 24 * 60 * 60,
  refreshTokenReuseInterval: 0,
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  // Client capability is broad; the consent UI defaults to read permissions only.
  clientRegistrationDefaultScopes: ["offline_access", ...MCP_SCOPES],
  clientRegistrationDefaultResources: [mcpResource],
  resources: [mcpResource],
} satisfies OAuthOptions<string[]>

const discoveryUrl = process.env.CLOUDFLARE_ACCESS_DISCOVERY_URL
const accessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID
const accessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET
if ([discoveryUrl, accessClientId, accessClientSecret].some(Boolean) &&
    ![discoveryUrl, accessClientId, accessClientSecret].every(Boolean))
  throw new Error("Cloudflare Access SSO requires discovery URL, client ID and client secret")

function createAuth() { return betterAuth({
  appName: "Circles",
  baseURL: publicUrl,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: db,
  trustedOrigins: [publicUrl],
  disabledPaths: ["/token"],
  account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
  plugins: [
    jwt(),
    mcp({ ...oauthOptions, resource: mcpResource }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ...(discoveryUrl && accessClientId && accessClientSecret ? [genericOAuth({ config: [{
      providerId: "cloudflare-access",
      discoveryUrl,
      clientId: accessClientId,
      clientSecret: accessClientSecret,
      scopes: ["openid", "email", "profile"],
      disableSignUp: true,
    }] })] : []),
    {
      id: "circles-mcp-access",
      endpoints: {
        verifyMcpAccess: createAuthEndpoint("/mcp/verify", {
          method: "POST",
          metadata: { SERVER_ONLY: true },
          body: z.object({
            authorization: z.string().min(1).max(16384), proof: z.string().max(16384).optional(),
            method: z.enum(["POST", "GET", "DELETE"]),
          }),
        }, async (ctx) => {
          const authorization = parseAccessTokenAuthorization(ctx.body.authorization)
          if (!authorization) throw new APIError("UNAUTHORIZED", { message: "Invalid MCP authorization" })
          const claims = await getOAuthProviderApi(ctx, oauthOptions)
            .requireActiveAccessToken(authorization.token)
          const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
          if (!claims.sub || !audience.includes(mcpResource))
            throw new APIError("UNAUTHORIZED", { message: "Invalid MCP access token" })
          await enforceDpopBinding({ payload: claims, authorization, proofJwt: ctx.body.proof,
            method: ctx.body.method, url: mcpResource, replayStore: createDpopReplayStore(ctx.context.internalAdapter) })
          return ctx.json(claims)
        }),
      },
    },
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.ALLOW_SIGNUP !== "true",
  },
}) }

// OAuth resource seeding needs the migrated database; defer it until auth is used.
let configuredAuth: ReturnType<typeof createAuth> | undefined
const instance = () => configuredAuth ??= createAuth()
export const auth = {
  get api() { return instance().api },
  get $context() { return instance().$context },
  get options() { return instance().options },
  handler(request: Request) { return instance().handler(request) },
}
