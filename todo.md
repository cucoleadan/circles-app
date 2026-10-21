# Circles CRM — open work

Open items only; completed work is in git history. Update this file when scope
or status changes. Last updated: 2026-10-21.

## Substack audience endpoints

- [ ] Verify after deploy: migration 035 retires queued `sync:followers` work,
      the following sweep (`/api/v1/feed/following`) completes, and
      `enrich:missing-handles` names the contacts it creates.
- [ ] Followers come only from follow notifications (Substack's
      `subscriber-lists` endpoint answers non-browser clients with a Cloudflare
      challenge since 2026-10-13). Unfollows are not detected. If a full list
      is needed again, capture it passively in the extension when the user
      opens their Followers page. The SDK's `getFollowing` still uses the
      challenged endpoint.

## MCP

- [ ] Live check of the SDK result cache: a repeated SDK call returns
      `_meta["circles/cached"] = true` without a new `mcp:substack` job, and
      `refresh: true` within 10 minutes still reuses the copy.

- [ ] Confirm Cursor completes the consent flow with write scopes.
- [ ] Resolve ChatGPT's "Missing OAuth callback data" error; confirm whether it
      now completes the flow and calls tools.
- [ ] Verify modern-client/gateway integration and actual Cloudflare SSO linking.
- [ ] Optional live smoke of `circles_post_note_now` + `circles_abort_note` and
      `circles_publish_existing_note` (a failed abort publishes a real Note).

## Going public

- [ ] Smoke test the live store build (0.3.0): a fresh install opens setup, pairs a server,
      connects Substack and captures there; re-pairing a second server switches over.
- [ ] Replace the Chrome Web Store listing screenshots with
      `extension/store-assets/screenshot-0*-1280x800.png` (dashboard only; the
      API cannot edit listings).
- [ ] Live `TZ` on api is `UTC`; set a local IANA zone if the MCP day brief
      should default to local time.

## Verify deployed fixes live (UI)

- [ ] Comments view, sync progress panel, and contact card layout with live data.
- [ ] Given/received per-action strip under the overview metrics.
- [ ] List member counts; companion confirmation flow.
- [ ] Contact refetch against a live contact (recent pages, not a full backfill).
- [ ] Handle repair: handle-less subscriber IDs that Substack returns 404 for
      must stay handle-less unless new identity evidence appears.
- [ ] Live unlike/unrestack smoke test and post/Note source reconciliation.

## Operations

- [ ] Backup policy beyond Dokploy's scheduled backups; a tested restore into a
      scratch database; measured read performance.

## Known limitations

- Older extension-captured restacks outside retained profile-feed evidence have
  no preview image; the data was never captured, so replay cannot add it.
