import { describe, expect, test } from "bun:test"

import {
  parseFollowerRunStartedAt,
  parseSubscriberStatsPage,
  shouldAbortFollowerSweep,
} from "../src/audience-sync.js"

describe("audience sync response normalization", () => {
  test("parses the current subscriber-stats shape and treats list membership as evidence", () => {
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
          subscription_created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          user_id: "102",
          user_name: "Founding Reader",
          is_subscribed: false,
          is_founding: true,
        },
      ],
    })

    expect(page).toEqual({
      total: 2,
      skipped: 0,
      subscribers: [
        {
          id: "101",
          name: "Free Reader",
          photo_url: "https://example.com/avatar.png",
          handle: null,
          subscription_type: "free",
          subscription_created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "102",
          name: "Founding Reader",
          photo_url: null,
          handle: null,
          subscription_type: "founding",
          subscription_created_at: null,
        },
      ],
    })
    expect(page.subscribers[0]).not.toHaveProperty("user_email_address")
    expect(page.subscribers[0]).not.toHaveProperty("is_subscribed")
  })

  test("accepts the legacy users/total shape and skips records without a stable ID", () => {
    expect(
      parseSubscriberStatsPage({
        total: 2,
        users: [
          { id: "profile-1", name: "Reader", handle: "@reader" },
          { name: "Missing identity" },
        ],
      })
    ).toEqual({
      total: 2,
      skipped: 1,
      subscribers: [
        {
          id: "profile-1",
          name: "Reader",
          photo_url: null,
          handle: "@reader",
          subscription_type: "free",
          subscription_created_at: null,
        },
      ],
    })
  })

  test("rejects a successful response without a subscriber collection", () => {
    expect(() => parseSubscriberStatsPage({ count: 4 })).toThrow(
      "did not contain a subscriber list"
    )
  })

  test("does not accept a future follower run boundary", () => {
    const now = new Date("2026-09-21T10:00:00.000Z")
    expect(parseFollowerRunStartedAt("2026-09-22T10:00:00.000Z", now)).toEqual(
      now
    )
    expect(
      parseFollowerRunStartedAt("2026-09-20T10:00:00.000Z", now).toISOString()
    ).toBe("2026-09-20T10:00:00.000Z")
  })

  test("aborts follower sweeps for authentication and rate-limit failures", () => {
    expect(shouldAbortFollowerSweep({ status: 401 })).toBe(true)
    expect(shouldAbortFollowerSweep({ statusCode: 429 })).toBe(true)
    expect(shouldAbortFollowerSweep({ message: "Request failed with 403" })).toBe(true)
    expect(shouldAbortFollowerSweep({ status: 404 })).toBe(false)
  })
})
