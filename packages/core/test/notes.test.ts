import { describe, expect, test } from "bun:test"

import {
  attachmentProblem,
  buildNoteBody,
  editableNoteBody,
  planVanishedNotes,
  triggerAtProblem,
} from "../src/notes.js"

const jane = { id: 11, handle: "janedoe", label: "Jane Doe" }

describe("note body", () => {
  test("drops mentions edited out of the text and dedupes repeats", () => {
    const doc = buildNoteBody("Hello @janedoe", [jane, jane, { id: 12, handle: "gone", label: "Gone" }])
    const mentions = JSON.stringify(doc).match(/substack_mention/g) ?? []
    expect(mentions).toHaveLength(1)
  })

  test("round-trips formatted Markdown with mentions", () => {
    const doc = buildNoteBody("Hi @janedoe, **bold** https://example.com\n- one\n- two", [jane])
    const editable = editableNoteBody(doc)
    // Mentions come back as @Label tokens; normalization may move a lone
    // space into a formatted word, which Substack would otherwise delete.
    expect(editable?.markdown).toStartWith("Hi @Jane Doe, **bold")
    expect(editable?.mentions).toEqual([{ id: 11, label: "Jane Doe", url: null }])
    expect(buildNoteBody(editable!.markdown, editable!.mentions)).toEqual(doc)
  })

  test("reports documents that cannot be edited as Markdown", () => {
    expect(editableNoteBody(null)).toBeNull()
    expect(editableNoteBody({ type: "doc", content: [{ type: "heading", content: [] }] })).toBeNull()
  })

  test("rejects empty and over-long text", () => {
    expect(() => buildNoteBody("")).toThrow()
    expect(() => buildNoteBody("x".repeat(5001))).toThrow()
  })
})

describe("schedule validation", () => {
  const now = Date.parse("2026-10-02T10:00:00Z")

  test("requires a future time within Substack's 92-day horizon", () => {
    expect(triggerAtProblem("not a date", now)).toMatch(/valid/)
    expect(triggerAtProblem("2026-10-02T09:59:00Z", now)).toMatch(/future/)
    expect(triggerAtProblem("2026-10-02T10:01:00Z", now)).toBeNull()
    expect(triggerAtProblem("2026-12-31T10:00:00Z", now)).toBeNull()
    expect(triggerAtProblem("2027-01-02T10:00:00Z", now)).toMatch(/92 days/)
  })

  test("allows six attachments with at most one link", () => {
    expect(attachmentProblem([{ type: "image" }, { type: "link" }])).toBeNull()
    expect(attachmentProblem([{ type: "link" }, { type: "link" }])).toMatch(/one link/)
    expect(attachmentProblem(Array.from({ length: 7 }, () => ({ type: "image" })))).toMatch(/at most 6/)
  })
})

describe("vanished drafts", () => {
  const now = Date.parse("2026-10-02T10:00:00Z")
  const row = (id: string, status: any, triggerAt: string | null) => ({ id, substackDraftId: `d${id}`, status, triggerAt })

  test("classifies drafts missing from the complete upstream list", () => {
    const changes = planVanishedNotes({
      now,
      local: [
        row("1", "scheduled", "2026-10-02T09:59:00Z"), // trigger passed
        row("2", "scheduled", "2026-10-03T09:00:00Z"), // removed before publishing
        row("3", "draft", null), // posted from Substack's composer
        row("4", "draft", null), // deleted in Substack
        row("5", "scheduled", "2026-10-03T09:00:00Z"), // still upstream
        row("6", "deleted", null), // later found in owned_content
        row("7", "published", "2026-10-01T09:00:00Z"),
      ],
      upstreamDraftIds: new Set(["d5"]),
      publishedAt: new Map([["d3", "2026-10-02T08:00:00Z"], ["d6", "2026-10-01T08:00:00Z"]]),
    })
    expect(changes).toEqual([
      { id: "1", status: "published", publishedAt: "2026-10-02T09:59:00.000Z" },
      { id: "2", status: "deleted", publishedAt: null },
      { id: "3", status: "published", publishedAt: "2026-10-02T08:00:00Z" },
      { id: "4", status: "deleted", publishedAt: null },
      { id: "6", status: "published", publishedAt: "2026-10-01T08:00:00Z" },
    ])
  })
})
