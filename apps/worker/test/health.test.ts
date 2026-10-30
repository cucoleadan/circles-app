import { expect, test } from "bun:test"
import { recordFailure, recordSuccess, UNHEALTHY_AFTER_MS, unhealthyReason } from "../src/health.js"

test("worker is unhealthy only after an hour of failures with no success", () => {
  const later = Date.now() + UNHEALTHY_AFTER_MS + 60_000
  expect(unhealthyReason(later)).toBeNull()

  recordFailure("getaddrinfo ETIMEOUT substack.com")
  expect(unhealthyReason()).toBeNull()
  expect(unhealthyReason(later)).toContain("getaddrinfo ETIMEOUT substack.com")

  recordSuccess()
  expect(unhealthyReason(later)).toBeNull()
})
