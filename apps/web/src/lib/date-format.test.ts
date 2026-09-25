import { describe, expect, test } from "bun:test"
import { formatListAddedDate, formatListPill, formatListTooltip } from "./date-format.js"

describe("formatListAddedDate and formatListTooltip", () => {
  test("formats valid ISO timestamp as dd.mm.yyyy", () => {
    // 2026-07-31T09:16:03.757Z
    const d = new Date(2026, 6, 31, 12, 0, 0)
    const formatted = formatListAddedDate(d.toISOString())
    expect(formatted).toBe("31.07.2026")
  })

  test("handles single-digit day and month with leading zero", () => {
    const d = new Date(2026, 0, 5, 12, 0, 0)
    const formatted = formatListAddedDate(d.toISOString())
    expect(formatted).toBe("05.01.2026")
  })

  test("returns null for null, undefined, or invalid date", () => {
    expect(formatListAddedDate(null)).toBeNull()
    expect(formatListAddedDate(undefined)).toBeNull()
    expect(formatListAddedDate("invalid-date")).toBeNull()
  })

  test("formatListTooltip returns 'Added to {list_name} on {dd.mm.yyyy}'", () => {
    const d = new Date(2026, 8, 22, 12, 0, 0)
    expect(formatListTooltip("VIP", d.toISOString())).toBe("Added to VIP on 22.09.2026")
  })

  test("formatListTooltip falls back gracefully when date is missing", () => {
    expect(formatListTooltip("VIP", null)).toBe("List: VIP")
    expect(formatListTooltip("VIP", undefined)).toBe("List: VIP")
  })

  test("formatListPill displays the membership date when available", () => {
    const d = new Date(2026, 8, 20, 12, 0, 0)
    expect(formatListPill("FRIENDS", d.toISOString())).toBe("FRIENDS - 20-09-26'")
    expect(formatListPill("FRIENDS", null)).toBe("FRIENDS")
  })
})
