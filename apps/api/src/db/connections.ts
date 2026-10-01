import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { createSubstackClient, sealSessionToken } from "@workspace/core"

export interface VerifiedSubstackProfile {
  id: string
  name: string | null
  handle: string | null
}

export class SubstackVerificationError extends Error {}

/**
 * Confirms the session token belongs to a readable Substack profile. Callers
 * must not replace a working connection when this fails: a stored token without
 * a profile ID breaks every profile-scoped sync stream.
 */
export async function verifySubstackSession(
  sessionToken: string,
  publicationUrl: string | null | undefined,
): Promise<VerifiedSubstackProfile> {
  let self: { id?: string | number; name?: string; handle?: string } | null
  try {
    const client = createSubstackClient({ sessionToken, publicationUrl })
    self = (await client.getAuthenticatedProfile()) as typeof self
  } catch (error) {
    console.warn("Could not verify Substack credentials:", (error as Error)?.message ?? error)
    throw new SubstackVerificationError("Substack did not accept this session. Sign in to Substack and try again.")
  }
  if (!self?.id) {
    throw new SubstackVerificationError("Substack did not return a profile for this session.")
  }
  return { id: String(self.id), name: self.name ?? null, handle: self.handle ?? null }
}

/**
 * Revokes the current connection, stores the verified replacement (encrypted
 * when SESSION_TOKEN_KEY is configured), and schedules its first sync so the
 * recurring sync chain starts immediately.
 */
export async function replaceSubstackConnection(
  client: PoolClient,
  appUserId: string,
  input: { sessionToken: string; publicationUrl: string | null; profile: VerifiedSubstackProfile },
) {
  const genRes = await client.query(
    "select coalesce(max(generation), 0) + 1 as next_gen from substack_connections where user_id = $1",
    [appUserId],
  )
  const nextGen = genRes.rows[0]?.next_gen ?? 1

  await client.query(
    "update substack_connections set status = 'revoked', updated_at = now() where user_id = $1 and status in ('active', 'expired')",
    [appUserId],
  )

  const sealed = sealSessionToken(input.sessionToken)
  const connId = randomUUID()
  const inserted = await client.query(
    `insert into substack_connections
        (id, user_id, generation, status, publication_url, envelope_version,
         key_id, wrapped_key, iv, ciphertext,
         profile_id, profile_name, profile_handle, last_verified_at)
     values ($1, $2, $3, 'active', $4, 1, $5, $6, $7, $8, $9, $10, $11, now())
     returning id, publication_url as "publicationUrl", profile_id as "profileId",
               profile_name as "profileName", profile_handle as "profileHandle",
               status, last_verified_at as "lastVerifiedAt"`,
    [
      connId, appUserId, nextGen, input.publicationUrl,
      sealed.keyId, sealed.wrappedKey, sealed.iv, sealed.ciphertext,
      input.profile.id, input.profile.name, input.profile.handle,
    ],
  )

  await client.query(
    `insert into sync_state (connection_id, user_id, status, next_run_at)
     values ($1, $2, 'idle', now())
     on conflict (connection_id) do update set status = 'idle', error = null, updated_at = now()`,
    [connId, appUserId],
  )

  await client.query(
    `insert into jobs (type, payload, status, run_at)
     values ('sync:activity', json_build_object('userId', $1::text, 'connectionId', $2::text), 'pending', now())`,
    [appUserId, connId],
  )

  return inserted.rows[0] as {
    id: string
    publicationUrl: string | null
    profileId: string
    profileName: string | null
    profileHandle: string | null
    status: string
    lastVerifiedAt: string
  }
}
