import { createDpopReplayStore, enforceDpopBinding, isDpopBindingError, parseAccessTokenAuthorization, verifyJwsAccessToken } from "better-auth/oauth2"
import { auth, mcpResource } from "../auth.js"
import { getOrCreateAppUser } from "../db/repositories.js"
import { withTenant } from "../db/tenant.js"
import type { McpPrincipal } from "./sdk-tools.js"

export class McpUnauthorized extends Error {}

export async function principalFor(request: Request): Promise<McpPrincipal> {
  const authorization = parseAccessTokenAuthorization(request.headers.get("authorization"))
  if (!authorization || !["Bearer", "DPoP"].includes(authorization.scheme) || !authorization.token)
    throw new McpUnauthorized("An OAuth access token is required")

  const context = await auth.$context
  let claims: Awaited<ReturnType<typeof verifyJwsAccessToken>>
  try {
    // Read our own keys directly; authentication must not depend on an HTTP self-call.
    claims = await verifyJwsAccessToken(authorization.token, {
      jwksFetch: () => auth.api.getJwks(), jwksCacheKey: auth,
      verifyOptions: { issuer: context.baseURL, audience: mcpResource, requiredClaims: ["sub", "iat", "exp"] },
    })
    await enforceDpopBinding({ payload: claims, authorization, proofJwt: request.headers.get("dpop"),
      method: request.method, url: mcpResource, replayStore: createDpopReplayStore(context.internalAdapter) })
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (isDpopBindingError(error) || /^(ERR_JWT|ERR_JWS|ERR_JWKS_NO_MATCHING_KEY)/.test(code))
      throw new McpUnauthorized("The OAuth access token or proof is invalid or expired")
    throw error
  }
  if (typeof claims.sub !== "string" || typeof claims.client_id !== "string" || typeof claims.iat !== "number" ||
      typeof claims.scope !== "string" || (claims.sid !== undefined && typeof claims.sid !== "string"))
    throw new McpUnauthorized("Invalid OAuth claims")

  const appUserId = await getOrCreateAppUser(claims.sub)
  const grant = await withTenant({ appUserId }, async (client) => (await client.query(
    `select g.scopes from "oauthConsent" g
     join "oauthClient" a on a."clientId" = g."clientId" and not coalesce(a.disabled, false)
     where g."clientId" = $1 and g."userId" = $3 and g.resources @> $4::jsonb
       and ($5::text is null or exists (select 1 from session s
         where s.id = $5 and s."userId" = g."userId" and s."expiresAt" > now()))
       and not exists (select 1 from mcp_grant_revocations v
         where v.client_id = $1 and extract(epoch from v.revoked_at) >= $2)
     limit 1`,
    [claims.client_id, claims.iat, claims.sub, JSON.stringify([mcpResource]), claims.sid ?? null],
  )).rows[0])
  if (!grant || !Array.isArray(grant.scopes)) throw new McpUnauthorized("The OAuth grant is no longer active")
  return { appUserId, authUserId: claims.sub, clientId: claims.client_id, issuedAt: claims.iat,
    scopes: new Set(claims.scope.split(" ").filter((scope) => grant.scopes.includes(scope))) }
}
