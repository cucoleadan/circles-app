import { expect, test } from "bun:test"
import { commentDateWindow } from "./comments.js"

test("the default comment window is exactly the preceding 48 hours", () => {
  expect(commentDateWindow(undefined, undefined, Date.parse("2026-10-12T13:30:00Z"))).toEqual({
    since: "2026-10-10T13:30:00.000Z",
    until: "2026-10-12T13:30:00.000Z",
  })
})

test("selecting one date includes the whole local day without changing the selected date", () => {
  const day = new Date(2026, 9, 12, 15, 30)
  expect(commentDateWindow(day)).toEqual({
    since: new Date(2026, 9, 12).toISOString(),
    until: new Date(2026, 9, 13).toISOString(),
  })
  expect(day.getHours()).toBe(15)
})

test("a selected range includes its last day and ends at the next local midnight", () => {
  expect(commentDateWindow(new Date(2026, 9, 24), new Date(2026, 9, 25))).toEqual({
    since: new Date(2026, 9, 24).toISOString(),
    until: new Date(2026, 9, 26).toISOString(),
  })
})
