# Circles CRM — open work

Open items only; completed work is in git history. Update this file when scope
or status changes. Last updated: 2026-10-21.

## Substack audience endpoints (blocking follower/following sync)

- [ ] Since 2026-10-13 every `sync:followers` and `sync:following` job
      dead-letters on HTTP 403 from `GET /api/v1/user/{id}/subscriber-lists`
      (`?lists=followers` on substack.com, `?lists=following` on the
      publication host). The SDK's MCP `get_following` fails on the same
      endpoint ("Substack authentication failed"), and `get_subscriptions`
      without arguments returns 400 from `/subscriptions`. Subscriber sync and
      activity sync are healthy. Next: capture the live response (status,
      content type, `cf-mitigated`) to tell a Cloudflare challenge from a
      changed or retired endpoint, then fix it in `unofficial-substack-sdk`.
- [ ] Re-check that CRM "following" matches upstream once the endpoint works
      again. MCP now serves following only from this sweep (`circles_list_people`
      view `following`), so it stays stale until the sweep recovers.

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
