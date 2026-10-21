import { describe, expect, test } from "bun:test"
import { claimAndRunJob } from "../src/jobs.js"
import { nextIncrementalSubscriberOffset, processSubscriberSyncPage } from "../src/audience.js"
import { needsAnotherActivityPage } from "../src/activity.js"

describe("Worker queue runner (claimAndRunJob)", () => {
  test("contact refetch dies on the first 429 instead of exceeding its request cap", async () => {
    const queries: string[] = []
    const mockClient: any = {
      query: async (sql: string) => {
        queries.push(sql)
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "refetch-1",
          type: "refetch:contact",
          payload: { userId: "user-1", personId: "person-1" },
          attempts: 0,
          max_attempts: 1,
        }] }
        return { rows: [] }
      },
      release: () => {},
    }
    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onContactRefetch: async () => { throw Object.assign(new Error("429"), { status: 429 }) },
    })
    expect(queries.some((sql) => sql.includes("set status = 'dead'"))).toBe(true)
    expect(queries.some((sql) => sql.includes("set status = 'pending'") && sql.includes("last_error = $3"))).toBe(false)
  })
  test("returns false when no jobs are pending", async () => {
    const mockClient: any = {
      query: async (sql: string) => {
        if (sql.includes("select id, type, payload")) {
          return { rows: [] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    const mockPool: any = {
      connect: async () => mockClient,
    }

    const result = await claimAndRunJob(mockPool, "test-worker-1")
    expect(result).toBe(false)
  })

  test("claims job, executes successfully, and marks status as done", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []

    const mockJob = {
      id: "job-101",
      type: "sync:activity",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1" }),
      attempts: 0,
      max_attempts: 5,
    }

    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })

        if (sql.includes("select id, type, payload")) {
          return { rows: [mockJob] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    const mockPool: any = {
      connect: async () => mockClient,
    }

    const result = await claimAndRunJob(mockPool, "test-worker-1", {
      onSync: async () => ({ skipped: false, stats: { processedItems: 12, newInteractions: 2, newPeople: 1 } }),
    })
    expect(result).toBe(true)

    // Verify lease was set
    const leaseUpdate = executedQueries.find((q) =>
      q.sql.includes("set status = 'running'")
    )
    expect(leaseUpdate).toBeDefined()
    expect(leaseUpdate?.params?.[0]).toBe("job-101")
    expect(leaseUpdate?.params?.[1]).toBe("test-worker-1")

    // Verify next notification poll was rescheduled
    const reschedule = executedQueries.find((q) =>
      q.sql.includes("insert into jobs") && q.sql.includes("10 minutes")
    )
    expect(reschedule).toBeDefined()
    expect(reschedule?.sql).toContain("existing.id <> $3")
    expect(reschedule?.params?.[2]).toBe("job-101")

    expect(executedQueries.some((q) => q.params?.[0] === "sync:subscribers")).toBe(true)
    // The follower sweep is retired; follow notifications set is_follower instead.
    expect(executedQueries.some((q) => q.params?.[0] === "sync:followers")).toBe(false)
    expect(executedQueries.some((q) => q.params?.[0] === "sync:following")).toBe(true)
    const historyJob = executedQueries.find((q) => q.sql.includes("select 'sync:history'") && q.params?.[0])
    expect(JSON.parse(historyJob?.params?.[0]).parentJobId).toBe("job-101")

    // Verify job was marked as done
    const doneUpdate = executedQueries.find((q) =>
      q.sql.includes("update jobs set status = 'done'")
    )
    expect(doneUpdate).toBeDefined()
    expect(doneUpdate?.params?.[0]).toBe("job-101")
    expect(JSON.parse(doneUpdate?.params?.[2])).toEqual({
      processedItems: 12, newInteractions: 2, newPeople: 1,
    })
  })

  test("activity poll skips refreshes still inside their 30-minute, 3-hour and daily windows", async () => {
    const runPoll = async (recent: "history" | "replies" | "audience") => {
      const executedQueries: { sql: string; params?: any[] }[] = []
      const mockClient: any = {
        query: async (sql: string, params: any[] = []) => {
          executedQueries.push({ sql, params })
          if (sql.includes("select id, type, payload")) return { rows: [{
            id: "job-102", type: "sync:activity", attempts: 0, max_attempts: 5,
            payload: { userId: "user-1", connectionId: "conn-1" },
          }] }
          if (recent === "history" && sql.includes("type = 'sync:history'") && params[1] === "owned_notes") return { rows: [{}] }
          if (recent === "replies" && sql.includes("type = 'sync:history'") && params[2] === "replies") return { rows: [{}] }
          if (recent === "audience" && sql.includes("'sync:following')") && sql.includes("23 hours")) return { rows: [{}] }
          return { rows: [] }
        },
        release: () => {},
      }
      await claimAndRunJob({ connect: async () => mockClient } as any, "test-worker-1", {
        onSync: async () => ({ skipped: false, stats: { processedItems: 1, newInteractions: 0, newPeople: 0 } }),
      })
      const queued = (stream: string, stage = "") => executedQueries.some((q) =>
        q.sql.includes("select 'sync:history'") && q.params?.[3] === stream && q.params?.[4] === stage)
      return {
        history: queued("owned_notes"),
        replies: queued("outbound_actions", "replies"),
        audience: executedQueries.some((q) => q.params?.[0] === "sync:subscribers"),
        poll: executedQueries.some((q) => q.sql.includes("select 'sync:activity'") && q.sql.includes("10 minutes")),
      }
    }
    expect(await runPoll("history")).toEqual({ history: false, replies: true, audience: true, poll: true })
    expect(await runPoll("replies")).toEqual({ history: true, replies: false, audience: true, poll: true })
    expect(await runPoll("audience")).toEqual({ history: true, replies: true, audience: false, poll: true })
  })

  test("schedules next page when import:history job is not yet completed", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []

    const mockJob = {
      id: "job-import-1",
      type: "import:history",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1", importRunId: "run-1" }),
      attempts: 0,
      max_attempts: 5,
    }

    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) {
          return { rows: [mockJob] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    const mockPool: any = {
      connect: async () => mockClient,
    }

    const result = await claimAndRunJob(mockPool, "test-worker-1", {
      onImport: async () => ({ completed: false }),
    })
    expect(result).toBe(true)

    // Verify next page was scheduled with a 2-second rate-limit pause
    const nextImportJob = executedQueries.find((q) =>
      q.sql.includes("insert into jobs") && q.sql.includes("2 seconds")
    )
    expect(nextImportJob).toBeDefined()

    // Verify tenant context was set for the import check
    const tenantQuery = executedQueries.find((q) =>
      q.sql.includes("set_config('app.user_id'") && q.params?.[0] === "user-1"
    )
    expect(tenantQuery).toBeDefined()

    // Verify current job marked done
    const doneUpdate = executedQueries.find((q) =>
      q.sql.includes("update jobs set status = 'done'")
    )
    expect(doneUpdate).toBeDefined()
  })

  test("handles job failure with exponential backoff retry when attempts < max_attempts", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []

    const mockJob = {
      id: "job-102",
      type: "sync:history",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1", stream: "owned_notes" }),
      attempts: 1,
      max_attempts: 3,
    }

    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) {
          return { rows: [mockJob] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    const mockPool: any = {
      connect: async () => mockClient,
    }

    const origConsoleError = console.error
    console.error = () => {}
    try {
      const result = await claimAndRunJob(mockPool, "test-worker-1", {
        onHistorySync: async () => {
          throw new Error("Temporary network timeout")
        },
      })
      expect(result).toBe(true)

      const retryUpdate = executedQueries.find((q) =>
        q.sql.includes("set status = 'pending'") && q.sql.includes("seconds")
      )
      expect(retryUpdate).toBeDefined()
      expect(retryUpdate?.params?.[0]).toBe("job-102")
      // attempts (1 + 1) * 30 = 60s delay
      expect(retryUpdate?.params?.[1]).toBe(60)
    } finally {
      console.error = origConsoleError
    }
  })

  test("moves job to dead letter status when attempts >= max_attempts", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []

    const mockJob = {
      id: "job-103",
      type: "sync:history",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1", stream: "owned_notes" }),
      attempts: 4,
      max_attempts: 5, // Next attempt = 5 >= 5 -> dead
    }

    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) {
          return { rows: [mockJob] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    const mockPool: any = {
      connect: async () => mockClient,
    }

    const origConsoleError = console.error
    console.error = () => {}
    try {
      const result = await claimAndRunJob(mockPool, "test-worker-1", {
        onHistorySync: async () => {
          throw new Error("Permanent fatal error")
        },
      })
      expect(result).toBe(true)

      const deadUpdate = executedQueries.find((q) =>
        q.sql.includes("update jobs set status = 'dead'")
      )
      expect(deadUpdate).toBeDefined()
      expect(deadUpdate?.params?.[0]).toBe("job-103")
      expect(deadUpdate?.params?.[1]).toBe("Permanent fatal error")
    } finally {
      console.error = origConsoleError
    }
  })

  test("rate limits do not exhaust the retry budget and use exponential backoff", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockJob = {
      id: "job-429",
      type: "import:history",
      payload: JSON.stringify({
        userId: "user-1",
        connectionId: "conn-1",
        importRunId: "run-1",
        stream: "owned_posts",
      }),
      attempts: 4,
      max_attempts: 5,
    }
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [mockJob] }
        return { rows: [] }
      },
      release: () => {},
    }
    const mockPool: any = { connect: async () => mockClient }
    const originalError = console.error
    console.error = () => {}
    try {
      await claimAndRunJob(mockPool, "test-worker-429", {
        onImport: async () => {
          const error: any = new Error("Substack request failed with 429.")
          error.status = 429
          throw error
        },
      })
    } finally {
      console.error = originalError
    }

    expect(executedQueries.some((query) => query.sql.includes("status = 'dead'"))).toBe(false)
    const retry = executedQueries.find((query) =>
      query.sql.includes("set status = 'pending'") && query.sql.includes("seconds"),
    )
    expect(retry?.params?.[1]).toBe(960)
    expect(executedQueries.some((query) =>
      query.sql.includes("update import_run_streams") && query.params?.[2]?.includes("retrying in 960 seconds"),
    )).toBe(true)
  })

  test("following sync queues one handle backfill for the contacts it created", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-following", type: "sync:following",
          payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1" }), attempts: 0, max_attempts: 5,
        }] }
        return { rows: [], rowCount: 1 }
      },
      release: () => {},
    }
    const log = console.log
    console.log = () => {}
    try {
      await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
        onFollowingSync: async () => ({ completed: true, skipped: false, checked: 3, updated: 3, subscribed: 0, created: 2, failed: 0 }),
      })
    } finally { console.log = log }
    const backfill = executedQueries.filter((query) => query.sql.includes("'enrich:missing-handles'"))
    expect(backfill).toHaveLength(1)
    expect(backfill[0]!.sql).toContain("not exists")
    expect(JSON.parse(backfill[0]!.params![0])).toEqual({ userId: "user-1", connectionId: "conn-1", placeholdersOnly: true })
  })

  test.each([
    ["sync:following", "onFollowingSync"],
  ] as const)("audience 403s retry up to the job attempt limit for %s", async (jobType, handlerName) => {
    for (const attempts of [3, 4]) {
      const executedQueries: { sql: string; params?: any[] }[] = []
      const mockClient: any = {
        query: async (sql: string, params: any[] = []) => {
          executedQueries.push({ sql, params })
          if (sql.includes("select id, type, payload")) return { rows: [{
            id: "job-403",
            type: jobType,
            payload: JSON.stringify({
              userId: "user-1", connectionId: "conn-1",
              importRunId: "run-1", stream: "following",
            }),
            attempts,
            max_attempts: 5,
          }] }
          return { rows: [] }
        },
        release: () => {},
      }
      const originalError = console.error
      console.error = () => {}
      try {
        await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
          [handlerName]: async () => {
            const error: any = new Error("Substack follower-list API failed (403)")
            error.status = 403
            throw error
          },
        })
      } finally {
        console.error = originalError
      }

      expect(executedQueries.some((query) => query.sql.includes("status = 'dead'"))).toBe(attempts === 4)
      expect(executedQueries.some((query) =>
        query.sql.includes("update import_run_streams") && query.params?.[2]?.includes("retrying"),
      )).toBe(attempts === 3)
      expect(executedQueries.some((query) =>
        query.sql.includes("update import_run_streams") && query.params?.[3] === "retry_limit",
      )).toBe(attempts === 4)
    }
  })

  test("marks the connection expired and dead-letters a 401 job", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockJob = {
      id: "job-401",
      type: "sync:subscribers",
      payload: JSON.stringify({
        userId: "user-1",
        connectionId: "conn-1",
        importRunId: "import-1",
        stream: "subscribers",
        offset: 0,
        runStartedAt: "2026-09-21T10:00:00.000Z",
      }),
      attempts: 0,
      max_attempts: 5,
    }
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [mockJob] }
        if (sql.includes("update import_run_streams") && sql.includes("returning status")) {
          return { rows: [{ status: "running" }] }
        }
        return { rows: [] }
      },
      release: () => {},
    }
    const originalError = console.error
    console.error = () => {}
    try {
      await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
        onSubscriberSync: async () => {
          const error: any = new Error("Substack subscriber API failed (401)")
          error.status = 401
          throw error
        },
      })
    } finally {
      console.error = originalError
    }

    expect(executedQueries.some((query) =>
      query.sql.includes("update substack_connections set status = 'expired'"),
    )).toBe(true)
    const dead = executedQueries.find((query) => query.sql.includes("status = 'dead'"))
    expect(dead?.params?.[1]).toBe("Substack session expired")
  })

  test("sync:activity reschedule uses deduplication clause", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockJob = {
      id: "job-sync-dedupe",
      type: "sync:activity",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1" }),
      attempts: 0,
      max_attempts: 5,
    }
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [mockJob] }
        return { rows: [] }
      },
      release: () => {},
    }
    const mockPool: any = { connect: async () => mockClient }
    await claimAndRunJob(mockPool, "test-worker-dedupe", {
      onSync: async () => ({ skipped: false }),
    })

    const reschedule = executedQueries.find((q) =>
      q.sql.includes("insert into jobs") && q.sql.includes("sync:activity") && q.sql.includes("where not exists"),
    )
    expect(reschedule).toBeDefined()
    expect(reschedule?.params?.[1]).toBe("conn-1")
  })

  test("subscriber sync schedules the next page as a durable job", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockJob = {
      id: "job-subscribers",
      type: "sync:subscribers",
      payload: JSON.stringify({
        userId: "user-1",
        connectionId: "conn-1",
        importRunId: "import-1",
        stream: "subscribers",
        offset: 0,
        runStartedAt: "2026-09-21T10:00:00.000Z",
      }),
      attempts: 0,
      max_attempts: 5,
    }
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [mockJob] }
        if (sql.includes("update import_run_streams") && sql.includes("returning status")) {
          return { rows: [{ status: "running" }] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onSubscriberSync: async () => ({
        completed: false,
        nextOffset: 100,
        total: 250,
        processed: 100,
        matched: 80,
        created: 20,
        invalid: 0,
        deactivated: 0,
        runStartedAt: "2026-09-21T10:00:00.000Z",
      }),
    })

    const nextPage = executedQueries.find((query) =>
      query.sql.includes("'sync:subscribers'") && query.params?.[1] === "2 seconds"
    )
    expect(nextPage).toBeDefined()
    expect(JSON.parse(nextPage?.params?.[0] ?? "{}")).toMatchObject({
      importRunId: "import-1",
      stream: "subscribers",
      offset: 100,
      processed: 100,
      matched: 80,
      created: 20,
      runStartedAt: "2026-09-21T10:00:00.000Z",
    })
    expect(executedQueries.some((query) => query.sql.includes("update import_run_streams"))).toBe(true)
  })

  test("missing handles backfill advances afterId and schedules next job", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockJob = {
      id: "job-handles",
      type: "enrich:missing-handles",
      payload: JSON.stringify({
        userId: "user-1",
        connectionId: "conn-1",
        importRunId: "run-1",
        stream: "missing_handles",
        afterId: null,
      }),
      attempts: 0,
      max_attempts: 5,
    }
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [mockJob] }
        if (sql.includes("update import_run_streams") && sql.includes("returning status")) {
          return { rows: [{ status: "running" }] }
        }
        return { rows: [] }
      },
      release: () => {},
    }

    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onMissingHandleBackfill: async () => ({
        completed: false,
        skipped: false,
        checked: 1,
        recovered: 1,
        failed: 0,
        afterId: "person-uuid-1",
      }),
    })

    const nextJob = executedQueries.find((query) =>
      query.sql.includes("'enrich:missing-handles'") && query.sql.includes("2 seconds")
    )
    expect(nextJob).toBeDefined()
    expect(JSON.parse(nextJob?.params?.[0] ?? "{}")).toMatchObject({
      afterId: "person-uuid-1",
      importRunId: "run-1",
    })
    expect(executedQueries.some((query) => query.sql.includes("update import_run_streams"))).toBe(true)
  })

  test("maintenance handle repair continues without an import run", async () => {
    const queries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        queries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-maintenance",
          type: "enrich:missing-handles",
          payload: { userId: "user-1", connectionId: "conn-1" },
          attempts: 0,
          max_attempts: 5,
        }] }
        return { rows: [] }
      },
      release: () => {},
    }
    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onMissingHandleBackfill: async () => ({ completed: false, skipped: false, afterId: "person-1" }),
    })
    const next = queries.find((query) => query.sql.includes("'enrich:missing-handles'") && query.sql.includes("2 seconds"))
    expect(JSON.parse(next?.params?.[0] ?? "{}").afterId).toBe("person-1")
    expect(queries.some((query) => query.sql.includes("update import_run_streams"))).toBe(false)
  })

  test("an optional profile 401 stops handle repair without expiring the connection", async () => {
    const queries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        queries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-handles-401",
          type: "enrich:missing-handles",
          payload: { userId: "user-1", connectionId: "conn-1" },
          attempts: 0,
          max_attempts: 5,
        }] }
        return { rows: [] }
      },
      release: () => {},
    }
    const originalError = console.error
    console.error = () => {}
    try {
      await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
        onMissingHandleBackfill: async () => {
          throw Object.assign(new Error("Profile request rejected"), { status: 401 })
        },
      })
    } finally {
      console.error = originalError
    }
    expect(queries.some((query) => query.sql.includes("update jobs set status = 'dead'"))).toBe(true)
    expect(queries.some((query) => query.sql.includes("update substack_connections set status = 'expired'"))).toBe(false)
  })
})

describe("Incremental subscriber sync", () => {
  const since = new Date("2026-09-30T00:00:00.000Z")

  test("walks a newest-first list until it passes the checkpoint", () => {
    expect(nextIncrementalSubscriberOffset({
      offset: 0, total: 2924, received: 100, pages: 1, since,
      dates: ["2026-10-01T10:00:00.000Z", "2026-09-30T12:00:00.000Z"],
    })).toEqual({ direction: "desc", nextOffset: 100 })
    expect(nextIncrementalSubscriberOffset({
      offset: 100, total: 2924, received: 100, pages: 2, since, direction: "desc",
      dates: ["2026-09-30T06:00:00.000Z", "2026-09-29T12:00:00.000Z"],
    })).toEqual({ direction: "desc", nextOffset: null })
  })

  test("jumps to the end of an oldest-first list and walks backwards", () => {
    expect(nextIncrementalSubscriberOffset({
      offset: 0, total: 2924, received: 100, pages: 1, since,
      dates: ["2021-01-01T00:00:00.000Z", "2021-02-01T00:00:00.000Z"],
    })).toEqual({ direction: "asc", nextOffset: 2824 })
    expect(nextIncrementalSubscriberOffset({
      offset: 2824, total: 2924, received: 100, pages: 2, since, direction: "asc",
      dates: ["2026-09-30T01:00:00.000Z", "2026-10-01T09:00:00.000Z"],
    })).toEqual({ direction: "asc", nextOffset: 2724 })
    expect(nextIncrementalSubscriberOffset({
      offset: 2724, total: 2924, received: 100, pages: 3, since, direction: "asc",
      dates: ["2026-09-28T01:00:00.000Z", "2026-09-30T01:00:00.000Z"],
    })).toEqual({ direction: "asc", nextOffset: null })
  })

  test("stops at the page cap", () => {
    expect(nextIncrementalSubscriberOffset({
      offset: 900, total: 2924, received: 100, pages: 10, since, direction: "desc",
      dates: ["2026-10-01T10:00:00.000Z"],
    }).nextOffset).toBeNull()
  })

  test("scheduled sync runs incremental reads after a recent full sweep", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-sync", type: "sync:activity",
          payload: { userId: "user-1", connectionId: "conn-1" }, attempts: 0, max_attempts: 5,
        }] }
        if (sql.includes("coalesce(payload->>'mode', 'full') = 'full'")) return { rows: [{ "?column?": 1 }] }
        return { rows: [] }
      },
      release: () => {},
    }
    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onSync: async () => ({ skipped: false }),
    })
    const subscribers = executedQueries.find((q) => q.params?.[0] === "sync:subscribers")
    expect(JSON.parse(subscribers?.params?.[1]).mode).toBe("incremental")
  })

  test("incremental pages carry their checkpoint and never reconcile", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    let received: any
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-inc", type: "sync:subscribers",
          payload: { userId: "user-1", connectionId: "conn-1", offset: 0, mode: "incremental", manual: false },
          attempts: 0, max_attempts: 5,
        }] }
        return { rows: [] }
      },
      release: () => {},
    }
    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onSubscriberSync: async (_c, _u, _conn, _offset, _run, incremental) => {
        received = incremental
        return {
          completed: false, mode: "incremental", nextOffset: 100, direction: "desc",
          since: since.toISOString(), pages: 1, total: 2924, processed: 100, matched: 100,
          created: 0, invalid: 0, deactivated: 0, runStartedAt: "2026-10-01T10:00:00.000Z",
        }
      },
    })
    expect(received).toMatchObject({ pages: 0 })
    const nextPage = executedQueries.find((q) => q.sql.includes("'sync:subscribers'") && q.params?.[1] === "30 seconds")
    expect(JSON.parse(nextPage?.params?.[0])).toMatchObject({
      mode: "incremental", offset: 100, direction: "desc", since: since.toISOString(), pages: 1,
    })
  })
})

describe("Full subscriber sweep", () => {
  test("overlaps pages so a mid-sweep unsubscribe cannot skip anyone", async () => {
    const mockClient: any = {
      query: async (sql: string) => {
        if (sql.includes("ciphertext, publication_url, status")) {
          return { rows: [{ ciphertext: "sid", publication_url: "https://example.substack.com", status: "active" }] }
        }
        return { rows: [], rowCount: 0 }
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({
      count: 250,
      subscribers: Array.from({ length: 100 }, (_, index) => ({ user_id: index + 1 })),
    }))) as any
    try {
      const middle = await processSubscriberSyncPage(mockClient, "user-1", "conn-1", 100)
      expect(middle).toMatchObject({ completed: false, nextOffset: 190, deactivated: 0 })
      const last = await processSubscriberSyncPage(mockClient, "user-1", "conn-1", 190)
      expect(last).toMatchObject({ completed: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("Recurring activity sync resilience", () => {
  test("never dead-letters the activity sync on repeated non-auth failures", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-activity", type: "sync:activity",
          payload: { userId: "user-1", connectionId: "conn-1" }, attempts: 9, max_attempts: 5,
        }] }
        return { rows: [] }
      },
      release: () => {},
    }
    const originalError = console.error
    console.error = () => {}
    try {
      await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
        onSync: async () => { throw Object.assign(new Error("Substack request failed with 403"), { status: 403 }) },
      })
    } finally {
      console.error = originalError
    }
    expect(executedQueries.some((q) => q.sql.includes("set status = 'dead'"))).toBe(false)
    const retry = executedQueries.find((q) => q.sql.includes("set status = 'pending'") && q.sql.includes("seconds"))
    expect(retry?.params?.[1]).toBe(1800)
    expect(executedQueries.some((q) => q.sql.includes("set status = 'expired'"))).toBe(false)
  })

  test("an unrelated 'expired' message does not expire the Substack connection", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-tls", type: "sync:history",
          payload: { userId: "user-1", connectionId: "conn-1", stream: "owned_posts" }, attempts: 0, max_attempts: 5,
        }] }
        return { rows: [] }
      },
      release: () => {},
    }
    const originalError = console.error
    console.error = () => {}
    try {
      await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
        onHistorySync: async () => { throw new Error("certificate has expired") },
      })
    } finally {
      console.error = originalError
    }
    expect(executedQueries.some((q) => q.sql.includes("set status = 'expired'"))).toBe(false)
  })

  test("follow-up jobs are skipped when the lease was lost", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-lost", type: "sync:activity",
          payload: { userId: "user-1", connectionId: "conn-1" }, attempts: 0, max_attempts: 5,
        }] }
        if (sql.includes("set status = 'done'")) return { rows: [], rowCount: 0 }
        return { rows: [] }
      },
      release: () => {},
    }
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
        onSync: async () => ({ skipped: false }),
      })
    } finally {
      console.warn = originalWarn
    }
    expect(executedQueries.some((q) => q.sql.includes("insert into jobs"))).toBe(false)
    expect(executedQueries.some((q) => q.sql === "commit")).toBe(true)
  })

  test("reads activity pages back to the checkpoint", () => {
    const checkpoint = new Date("2026-10-01T08:00:00.000Z")
    const recent = [{ id: "a", created_at: "2026-09-30T01:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z" }]
    expect(needsAnotherActivityPage(recent, checkpoint, "cursor", 1)).toBe(true)
    const reached = [{ id: "b", created_at: "2026-10-01T07:00:00.000Z", updated_at: "2026-10-01T07:30:00.000Z" }]
    expect(needsAnotherActivityPage(reached, checkpoint, "cursor", 1)).toBe(false)
    expect(needsAnotherActivityPage(recent, null, "cursor", 1)).toBe(false)
    expect(needsAnotherActivityPage(recent, checkpoint, null, 1)).toBe(false)
    expect(needsAnotherActivityPage(recent, checkpoint, "cursor", 5)).toBe(false)
  })
})
