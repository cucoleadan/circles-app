# Note scheduling

Status: implemented locally on 2026-10-02, not yet deployed. The first
version of this plan (2026-10-01) was written against SDK 0.3.16. SDK 0.4.0
answered its open questions, and this file now describes what was built.

## What it does

A `/notes` page (linked from the contacts navbar) where you can:

- write a Note in Note Markdown (bold, italic, strike, code, lists, quotes,
  bare links), @-mention contacts from the CRM, and attach up to 6 items:
  images, plus at most one link;
- **Post now**: Circles schedules the Note 60 seconds ahead, shows a
  countdown banner, and lets you **Abort** until 3 seconds before it fires.
  Aborting keeps the Note as an unscheduled draft;
- **Schedule** it with a day picker, a time and quick slots, up to 92 days
  ahead, in the browser's time zone;
- **save a draft** with no time. Drafts are real Substack drafts, so they
  also appear in Substack's own composer;
- edit, reschedule, move back to drafts, post now, duplicate, or delete any
  open Note, including ones created in Substack's app;
- see everything in three views: **Queue** (by day, with Drafts and
  Published in the last 14 days), **Calendar** (month grid with overflow
  popovers, plus a rail of unscheduled drafts) and **Table** (sortable,
  filterable data table with status and column toggles).

## Decisions (confirmed 2026-10-01)

1. Drafts without a time: yes. They're stored as Substack drafts
   (`createDraftNote`), not as local-only rows.
2. Post now: yes, with a 1-minute delay and an Abort button.
3. Notes scheduled in Substack's own app: imported and fully manageable.
4. A dedicated `/notes` page.

## SDK facts this relies on (unofficial-substack-sdk 0.4.0)

- Substack publishes scheduled drafts itself at `trigger_at`, with no
  minimum lead time, and deletes or unschedules up to `trigger_at` stop the
  publish. So Circles runs no publish job.
- A published Note keeps its draft ID, which is also the `owned_content`
  external ID.
- `getAllDraftNotes` returns scheduled and unscheduled drafts, and throws
  instead of returning a partial list.
- A `trigger_at` more than 92 days ahead fails **but leaves a stray draft**.
  The API validates the horizon first (with a 1-hour margin).
- `updateScheduledNote`/`unscheduleNote` replace the attachment list, so the
  API always re-sends the IDs to keep.
- Markdown and the document round-trip exactly
  (`markdownToNoteBodyJson`/`noteBodyJsonToMarkdown`). Mentions come back as
  `@Label`. Documents that can't round-trip are shown read-only, and only
  their time and reply audience can change.

## Architecture

```
apps/web  /notes  (NotesScheduler: composer, queue, calendar, table)
   │  /api/v1/notes/*
   ▼
apps/api  routes/v1/notes.ts ──► db/scheduled-notes.ts (withTenant + RLS)
   │                       └──► SDK (no DB transaction held across upstream calls)
   ▼
packages/core  notes.ts  (body building, validation, vanished-draft rules)
   ▼
Substack (owns the drafts and publishes them)
```

- **Migration `029_scheduled_notes.sql`:** a tenant-scoped mirror of the
  account's Note drafts. It records origin (`circles`/`substack`), status
  (`pending`, `draft`, `scheduled`, `published`, `deleted`), the `post_now`
  flag, a unique `client_request_id` for idempotent creates, and the raw
  upstream draft. It also adds
  `substack_connections.drafts_reconciled_at` for throttling.
- **Refresh:** `POST /notes/refresh` reads the complete draft list (at most
  every 30 s, or every 5 s with `force=1`). It upserts every draft, and
  removes `pending` rows older than 5 minutes; any draft such a row created is
  imported anyway. It then classifies drafts that have disappeared:
  - found in `owned_content`, or a scheduled time that has passed:
    published;
  - otherwise: deleted.
  - A `deleted` row that later shows up in `owned_content` is corrected to
    published.
- **Routes:**

  | Route | Purpose |
  | --- | --- |
  | `GET /notes` | Mirror and published Notes in range, no upstream call |
  | `POST /notes/refresh` | Reconcile with Substack, then list |
  | `POST /notes` | Create, with mode `draft`, `schedule` or `post_now` |
  | `PATCH /notes/:id` | Edit, reschedule, unschedule or post now |
  | `POST /notes/:id/abort` | Stop a Post now and keep the Note as a draft |
  | `DELETE /notes/:id` | Delete upstream |
  | `POST /notes/images` | Multipart upload, max 15 MB, PNG/JPEG/GIF/WebP checked by magic bytes |

  - An upstream 401 marks the connection expired, as the worker does.
  - Mutations within 3 s of `trigger_at` are refused, so they can't race
    the publish.
- **Published history:** the calendar and the table also show authored Notes
  from `owned_content` that weren't scheduled through Circles.

## Verification done

- `bun run typecheck`, `bun run build` and the full root test suite all
  pass: 102 tests.
- New tests:
  - `packages/core/test/notes.test.ts`: body building, round-trip,
    validation, and the vanished-draft rules;
  - a `note scheduling` block in `apps/api/test/crm.test.ts`, run against a
    fake Substack. It covers idempotent create, draft to schedule to draft,
    post now and abort, the abort cutoff, validation without upstream calls,
    upstream error mapping, 401 expiry, delete, reconcile/import/throttle,
    and tenant isolation.
- UI checked with Playwright against a mock API: the three views, the mention
  picker, the Post now countdown and Abort, and no horizontal overflow at
  phone width.

## Not done yet

1. **Deploy:** migration `029` applies automatically on deploy.
2. **Live smoke test on the real account (needs your go-ahead):**
   - schedule a Note about 15 minutes ahead with a mention and an image;
   - reschedule it and check Substack's scheduled list;
   - let it publish and confirm Circles marks it published with a working
     link;
   - Post now, then Abort;
   - delete a scheduled Note.
3. Unverified upstream behavior: the SDK verified `unscheduleNote` on
   scheduled drafts. Using it to save edits to an already unscheduled draft
   is assumed to work. If Substack rejects it, editing an existing draft will
   show an error.
4. Optional follow-ups:
   - a worker job that refreshes the mirror without the page open;
   - "Mention in a Note" from the contact drawer;
   - highlighting empty days in the calendar.
