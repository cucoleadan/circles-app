import { describe, expect, test } from "bun:test"

import {
  parseFollowerRunStartedAt,
  parseSubscriberStatsPage,
  shouldAbortFollowerSweep,
} from "../src/audience.js"

describe("audience sync response normalization", () => {
  test("parses the current subscriber shape without retaining private fields", () => {
    const page = parseSubscriberStatsPage({
      count: 2,
      subscribers: [
        {
          user_id: 101,
          user_name: "Free Reader",
          user_email_address: "private@example.com",
          user_photo_url: "https://example.com/avatar.png",
          is_subscribed: false,
          subscription_type: null,
        },
        { user_id: "102", user_name: "Founding Reader", is_founding: true },
      ],
    })

    expect(page.total).toBe(2)
    expect(page.received).toBe(2)
    expect(page.skipped).toBe(0)
    expect(page.subscribers[0]).toMatchObject({
      id: "101",
      name: "Free Reader",
      subscription_type: "free",
    })
    expect(page.subscribers[1]?.subscription_type).toBe("founding")
    expect(page.subscribers[0]).not.toHaveProperty("user_email_address")
    expect(page.subscribers[0]).not.toHaveProperty("is_subscribed")
  })

  test("accepts the legacy users/total shape and skips missing stable IDs", () => {
    const page = parseSubscriberStatsPage({
      total: 2,
      users: [
        { id: "profile-1", name: "Reader", handle: "@reader" },
        { name: "Missing identity" },
      ],
    })
    expect(page).toMatchObject({ total: 2, received: 2, skipped: 1 })
    expect(page.subscribers).toHaveLength(1)
    expect(page.subscribers[0]?.id).toBe("profile-1")
  })

  test("rejects responses without a subscriber collection", () => {
    expect(() => parseSubscriberStatsPage({ count: 4 })).toThrow(
      "did not contain a subscriber list"
    )
  })

  test("validates follower run boundaries", () => {
    const now = new Date("2026-09-21T10:00:00.000Z")
    expect(parseFollowerRunStartedAt("2026-09-22T10:00:00.000Z", now)).toEqual(now)
    expect(parseFollowerRunStartedAt("2026-09-20T10:00:00.000Z", now).toISOString()).toBe(
      "2026-09-20T10:00:00.000Z"
    )
  })

  test("aborts only authentication and rate-limit failures", () => {
    expect(shouldAbortFollowerSweep({ status: 401 })).toBe(true)
    expect(shouldAbortFollowerSweep({ statusCode: 429 })).toBe(true)
    expect(shouldAbortFollowerSweep({ status: 403 })).toBe(false)
    expect(shouldAbortFollowerSweep({ status: 404 })).toBe(false)
  })
})
