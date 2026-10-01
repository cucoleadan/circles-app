import { describe, expect, test } from "bun:test"

import { collapsePagedSteps } from "../src/routes/v1/sync.js"

const step = (id: string, type: string, status: string, result: Record<string, number> | null = null) => ({
  id,
  type,
  status,
  startedAt: `start-${id}`,
  createdAt: `created-${id}`,
  updatedAt: `updated-${id}`,
  result,
  pages: 1,
})

describe("sync progress steps", () => {
  test("shows each paged sweep as one step with its latest totals", () => {
    const steps = collapsePagedSteps([
      step("1", "sync:activity", "done"),
      step("2", "sync:subscribers", "done", { processed: 100 }),
      step("3", "sync:followers", "done", { checked: 203 }),
      step("4", "sync:following", "dead"),
      step("5", "sync:subscribers", "done", { processed: 200 }),
      step("6", "sync:subscribers", "running", { processed: 549 }),
    ])

    expect(steps.map((item) => item.type)).toEqual([
      "sync:activity",
      "sync:subscribers",
      "sync:followers",
      "sync:following",
    ])
    expect(steps[1]).toMatchObject({
      id: "6",
      status: "running",
      result: { processed: 549 },
      pages: 3,
      startedAt: "start-2",
      createdAt: "created-2",
    })
    expect(steps[2]?.pages).toBe(1)
  })
})
