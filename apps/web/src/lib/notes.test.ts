import { expect, test } from "bun:test"
import { parseTimeText } from "./notes.js"

test("parseTimeText accepts 24h and 12h pastes", () => {
  expect(parseTimeText("17:00")).toBe("17:00")
  expect(parseTimeText(" 9:05 ")).toBe("09:05")
  expect(parseTimeText("1700")).toBe("17:00")
  expect(parseTimeText("17.30")).toBe("17:30")
  expect(parseTimeText("5pm")).toBe("17:00")
  expect(parseTimeText("5:30 PM")).toBe("17:30")
  expect(parseTimeText("12 am")).toBe("00:00")
  expect(parseTimeText("12:15 p.m.")).toBe("12:15")
  expect(parseTimeText("24:00")).toBeNull()
  expect(parseTimeText("13pm")).toBeNull()
  expect(parseTimeText("tomorrow")).toBeNull()
})
