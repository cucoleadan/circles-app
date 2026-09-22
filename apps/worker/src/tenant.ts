import type { PoolClient } from "pg"

export async function withTenant<T>(
  client: PoolClient,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  await client.query("begin")
  try {
    await client.query("select set_config('app.user_id', $1, true)", [userId])
    const result = await fn()
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  }
}

export function substackResponseError(message: string, status: number) {
  const error = new Error(`${message} (${status})`) as Error & { status: number }
  error.status = status
  return error
}
