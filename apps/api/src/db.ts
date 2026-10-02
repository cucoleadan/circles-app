import { runtimeDatabaseUrl } from "@workspace/core"
import { Pool } from "pg"

export const db = new Pool({
  connectionString: runtimeDatabaseUrl(),
  max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
  // Fail a request instead of queueing forever when every connection is busy.
  connectionTimeoutMillis: 10_000,
  // Postgres ends sessions that sit idle inside a transaction, so a stalled
  // handler cannot pin row locks or a pool slot indefinitely.
  idle_in_transaction_session_timeout: 60_000,
  statement_timeout: 60_000,
})
