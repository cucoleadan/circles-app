# Circles CRM — open work

Open items only; completed work is in git history. Update this file when scope
or status changes. Last updated: 2026-10-23.

## Substack audience endpoints

- [ ] Confirm the larger account's first scheduled following sweep (the
      2026-10-21 manual run covered the smaller one: 1,302 checked, 256
      followed, 43 created, placeholder names resolving) and that its
      backfill stays limited to the sweep's placeholder contacts.
- [ ] Followers come only from follow notifications (Substack's
      `subscriber-lists` endpoint answers non-browser clients with a Cloudflare
      challenge since 2026-10-13). Unfollows are not detected. If a full list
      is needed again, capture it passively in the extension when the user
      opens their Followers page. The SDK's `getFollowing` still uses the
      challenged endpoint.

## Newsletter Signals

- [ ] Apply migration `036_newsletter_signals` on a test DB, then run one live
      export from the Newsletter Signals view (create → poll → download → store).
- [ ] Subscriber signals are keyed by email and not linked to CRM contacts
      (`people` has no email). Link them if Substack exposes email → profile ID.
- [ ] Very large exports: the zip is read in memory and zip64 is rejected.

## MCP

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
- [ ] Live `TZ` on api is `UTC` (compose passes `${TZ:-UTC}`); add
      `TZ=Europe/Bucharest` (or the owner's IANA zone) to the Dokploy compose
      env if the MCP day brief should default to local time.

## Verify deployed fixes live (UI)

- [ ] Comments view, sync progress panel, and contact card layout with live data.
- [ ] Given/received per-action strip under the overview metrics.
- [ ] List member counts; companion confirmation flow.
- [ ] Contact refetch against a live contact (recent pages, not a full backfill).
- [ ] Handle repair: handle-less subscriber IDs that Substack returns 404 for
      must stay handle-less unless new identity evidence appears.
- [ ] Live unlike/unrestack smoke test and post/Note source reconciliation.

## Operations

- [ ] Off-site copies: daily dumps (compose `backup` service) stay on the
      database host. Add a Dokploy S3 destination or copy `/backups` off the
      server. Restore drill and read timings are in `docs/operations.md`.
- [ ] Comment history over ranges longer than 31 days still ranks every
      inbound comment (~510 ms on the 9.4k-contact account); index the comment
      key if that view gets slow.

## Known limitations

- Older extension-captured restacks outside retained profile-feed evidence have
  no preview image; the data was never captured, so replay cannot add it.
