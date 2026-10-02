import { describe, expect, test } from "bun:test"

import {
  attachmentProblem,
  isEditableNoteBody,
  noteBodyMentions,
  noteBodyText,
  planVanishedNotes,
  prepareNoteBody,
  triggerAtProblem,
} from "../src/notes.js"

const paragraph = (...content: unknown[]) => ({ type: "paragraph", content })
const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) })
const jane = { type: "substack_mention", attrs: { id: 11, label: "Jane Doe", mentionType: "user", url: null } }

/** The shape a Tiptap editor (StarterKit + mention) produces. */
const editorDoc = {
  type: "doc",
  content: [
    paragraph(text("Hi "), jane, text(", "), text("bold", [{ type: "bold" }])),
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [paragraph(text("one"))] },
        { type: "listItem", content: [paragraph(text("two"))] },
      ],
    },
    { type: "blockquote", content: [paragraph(text("quoted"))] },
    paragraph(text("a"), { type: "hardBreak" }, text("b")),
  ],
}

describe("note body", () => {
  test("normalizes editor JSON into Substack's stored form", () => {
    const doc = prepareNoteBody(editorDoc)
    expect(doc.attrs).toEqual({ schemaVersion: "v1", title: null })
    // Hard breaks become paragraph breaks, as Substack stores them.
    expect(noteBodyText(doc)).toBe("Hi @Jane Doe, bold\n- one\n- two\n> quoted\na\nb")
    expect(noteBodyMentions(doc)).toEqual([{ id: 11, label: "Jane Doe" }])
  })

  test("rejects unsupported formatting, empty Notes, and over-long text", () => {
    expect(() => prepareNoteBody({ type: "doc", content: [{ type: "heading", content: [text("H")] }] })).toThrow()
    expect(() => prepareNoteBody({ type: "doc", content: [{ type: "paragraph" }] })).toThrow(/Write something/)
    expect(prepareNoteBody({ type: "doc", content: [{ type: "paragraph" }] }, { hasAttachments: true }).content).toEqual([])
    expect(() => prepareNoteBody({ type: "doc", content: [paragraph(text("x".repeat(5001)))] })).toThrow(/5,000/)
  })

  test("reports documents the editor cannot load", () => {
    expect(isEditableNoteBody(editorDoc)).toBe(true)
    expect(isEditableNoteBody(null)).toBe(false)
    expect(isEditableNoteBody({ type: "doc", content: [{ type: "heading", content: [] }] })).toBe(false)
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
