import type { PoolClient } from "pg"

import { db } from "../db.js"

export interface TenantContext {
  appUserId?: string
  authUserId?: string
}

/**
 * Runs `fn` inside a transaction with the tenant context set transaction-locally
 * on the pooled connection, so row level security scopes every statement and the
 * context can never persist between requests.
 */
export async function withTenant<T>(
  context: TenantContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect()
  try {
    await client.query("begin")
    if (context.appUserId !== undefined)
      await client.query("select set_config('app.user_id', $1, true)", [
        context.appUserId,
      ])
    if (context.authUserId !== undefined)
      await client.query("select set_config('app.auth_user_id', $1, true)", [
        context.authUserId,
      ])
    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
