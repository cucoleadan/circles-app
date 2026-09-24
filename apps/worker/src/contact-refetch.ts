import type { PoolClient } from "pg"
import { createSubstackClient, ingestActivityBatch, normalizeActivityPage } from "@workspace/core"
import { preserveActivityEvidence } from "./activity.js"
import { syncRecentOutboundActions, type OutboundStage } from "./history.js"
import { withTenant } from "./tenant.js"

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() :
  typeof value === "number" ? String(value) : null

const paceRequest = () => new Promise<void>((resolve) => setTimeout(resolve, 2000))

export async function processContactRefetch(client: PoolClient, userId: string, personId: string) {
  return withTenant(client, userId, async () => {
    const person = (await client.query(
      `select id, handle, substack_profile_id from people
       where id = $1 and user_id = $2 and archived_at is null`,
      [personId, userId],
    )).rows[0]
    if (!person || (!person.handle && !person.substack_profile_id))
      throw new Error("Contact has no Substack identity")

    const connection = (await client.query(
      `select id, ciphertext, publication_url, profile_id, profile_handle
       from substack_connections where user_id = $1 and status = 'active'
       order by generation desc limit 1`,
      [userId],
    )).rows[0]
    if (!connection) throw new Error("No active Substack connection")

    const sdk = createSubstackClient({
      sessionToken: connection.ciphertext,
      publicationUrl: connection.publication_url,
    })
    // One public profile request, one activity page, and at most three owner-feed
    // pages. This job has max_attempts=1, so a failed request is never retried.
    const profileResponse: any = person.handle
      ? await sdk.getPublicProfile(person.handle)
      : await sdk.getProfileById(person.substack_profile_id)
    const profile = profileResponse?.profile ?? profileResponse?.user ?? profileResponse
    const upstreamId = stringValue(profile?.id ?? profile?.user_id ?? profile?.profile_id)
    const upstreamHandle = stringValue(profile?.handle ?? profile?.username)
    if (person.substack_profile_id && upstreamId && upstreamId !== person.substack_profile_id)
      throw new Error("Public profile does not match this contact")
    if (person.handle && upstreamHandle && upstreamHandle.toLowerCase() !== person.handle.toLowerCase())
      throw new Error("Public profile does not match this contact")
    const avatar = stringValue(profile?.photo_url ?? profile?.photoUrl ?? profile?.avatar_url ?? profile?.avatarUrl)
    if (avatar) {
      await client.query(
        `update people set avatar_url = $1, updated_at = now()
         where id = $2 and user_id = $3`,
        [avatar, personId, userId],
      )
    }
    await client.query(
      `insert into profile_snapshots
         (person_id, user_id, connection_id, schema_version, payload, fetched_at, last_attempted_at)
       values ($1, $2, $3, 1, $4, now(), now())
       on conflict (person_id) do update set
         connection_id = excluded.connection_id, payload = excluded.payload,
         fetched_at = now(), last_attempted_at = now(), last_error = null`,
      [personId, userId, connection.id, JSON.stringify(profileResponse)],
    )

    await paceRequest()
    const activity = await sdk.getActivityPage()
    await preserveActivityEvidence(client, userId, connection.id, "sdk", activity)
    await ingestActivityBatch(client, {
      userId,
      connectionId: connection.id,
      ownerHandle: connection.profile_handle,
      ownerId: connection.profile_id,
      items: normalizeActivityPage(activity),
      source: "sdk",
    })

    if (connection.profile_id) {
      for (const stage of ["likes", "restacks", "replies"] as OutboundStage[]) {
        await paceRequest()
        await syncRecentOutboundActions(client, sdk, {
          userId,
          connectionId: connection.id,
          ownerId: connection.profile_id,
          ownerHandle: connection.profile_handle,
          source: "sdk",
        }, 20, stage)
      }
    }
  })
}
