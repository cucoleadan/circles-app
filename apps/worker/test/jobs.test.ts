import { describe, expect, test } from "bun:test"
import { claimAndRunJob } from "../src/jobs.js"

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
      onSync: async () => ({ skipped: false }),
    })
    expect(result).toBe(true)

    // Verify lease was set
    const leaseUpdate = executedQueries.find((q) =>
      q.sql.includes("set status = 'running'")
    )
    expect(leaseUpdate).toBeDefined()
    expect(leaseUpdate?.params?.[0]).toBe("job-101")
    expect(leaseUpdate?.params?.[1]).toBe("test-worker-1")

    // Verify next sync job was rescheduled for 3 hours
    const reschedule = executedQueries.find((q) =>
      q.sql.includes("insert into jobs") && q.sql.includes("3 hours")
    )
    expect(reschedule).toBeDefined()
    expect(reschedule?.sql).toContain("existing.id <> $3")
    expect(reschedule?.params?.[2]).toBe("job-101")

    expect(executedQueries.some((q) => q.params?.[0] === "sync:subscribers")).toBe(true)
    expect(executedQueries.some((q) => q.params?.[0] === "sync:followers")).toBe(true)

    // Verify job was marked as done
    const doneUpdate = executedQueries.find((q) =>
      q.sql.includes("update jobs set status = 'done'")
    )
    expect(doneUpdate).toBeDefined()
    expect(doneUpdate?.params?.[0]).toBe("job-101")
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
      type: "sync:activity",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1" }),
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
        onSync: async () => {
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
      type: "sync:activity",
      payload: JSON.stringify({ userId: "user-1", connectionId: "conn-1" }),
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
        onSync: async () => {
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

  test("temporary follower 403s stay queued instead of failing the import", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockClient: any = {
      query: async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params })
        if (sql.includes("select id, type, payload")) return { rows: [{
          id: "job-403",
          type: "sync:followers",
          payload: JSON.stringify({
            userId: "user-1", connectionId: "conn-1",
            importRunId: "run-1", stream: "followers",
          }),
          attempts: 4,
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
        onFollowerSync: async () => {
          const error: any = new Error("Substack follower-list API failed (403)")
          error.status = 403
          throw error
        },
      })
    } finally {
      console.error = originalError
    }

    expect(executedQueries.some((query) => query.sql.includes("status = 'dead'"))).toBe(false)
    expect(executedQueries.some((query) =>
      query.sql.includes("update import_run_streams") && query.params?.[2]?.includes("retrying"),
    )).toBe(true)
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
      query.sql.includes("'sync:subscribers'") && query.sql.includes("2 seconds")
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

  test("manual follower sweeps continue in paced background batches", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = []
    const mockJob = {
      id: "job-followers",
      type: "sync:followers",
      payload: JSON.stringify({
        userId: "user-1",
        connectionId: "conn-1",
        runStartedAt: "2026-09-21T10:00:00.000Z",
        fullSweep: true,
        limit: 20,
      }),
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

    await claimAndRunJob({ connect: async () => mockClient } as any, "worker", {
      onFollowerSync: async () => ({
        completed: false,
        checked: 20,
        updated: 19,
        failed: 1,
        remaining: 40,
        runStartedAt: "2026-09-21T10:00:00.000Z",
      }),
    })

    const nextBatch = executedQueries.find((query) =>
      query.sql.includes("'sync:followers'") && query.sql.includes("5 seconds")
    )
    expect(nextBatch).toBeDefined()
    expect(JSON.parse(nextBatch?.params?.[0] ?? "{}")).toMatchObject({
      checked: 20,
      updated: 19,
      failed: 1,
      fullSweep: true,
    })
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
