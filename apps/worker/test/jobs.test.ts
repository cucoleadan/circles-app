import { describe, expect, test } from "bun:test"
import { claimAndRunJob } from "../src/jobs.js"

describe("Worker queue runner (claimAndRunJob)", () => {
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

    // Verify next sync job was rescheduled for 15 minutes
    const reschedule = executedQueries.find((q) =>
      q.sql.includes("insert into jobs") && q.sql.includes("15 minutes")
    )
    expect(reschedule).toBeDefined()

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
})

