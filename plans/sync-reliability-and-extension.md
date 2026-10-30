# Sync reliability and extension plan

Status: plan, 2026-10-30. Nothing here is built yet. Mirrors the shared
Claude doc "Circles: sync reliability and extension plan".

## Context

The activity sync is healthy. The work is in the audience sweeps, the
extension release path and the extension's UX.

| Job type | Last 14 days | Problem |
| --- | --- | --- |
| `sync:activity` | 3,788 done | Only failures were the 2026-10-29 DNS outage (fixed in `608e962`) |
| `sync:subscribers` | 119 done, 7 dead | 50 Cloudflare 403 challenges |
| `sync:following` | 15 done, 10 dead | 28 Cloudflare 403 challenges |
| `sync:followers` (retired) | 10 dead | 22 Cloudflare 403 challenges |

Each blocked sweep retried 5 times against an endpoint that was already
challenging us. Goal: stay under Substack's bot scoring by behaving less like
a bot, not by evading it.

## Sync reliability

Five worker changes, smallest and highest-value first. All live in
`apps/worker` and none needs a migration: the circuit breaker just
reschedules the blocked job 6–24 h out instead of burning its retries.

| # | Change | Why | Size |
| --- | --- | --- | --- |
| 1 | **403 circuit breaker**: on a Cloudflare challenge, park that stream 6–24 h and mark it unavailable, not failed | Retrying 5× into a challenge is what raises our bot score | S |
| 2 | **Jitter**: ±20% on every schedule (10 min, 3 h, 23 h, 7 d); spread the heavy sweeps apart | Exact cadences are an automation signature | S |
| 3 | **Outage catch-up**: raise the 5-page cap when the last success is old; cap `sync:activity` retry backoff at 10 min instead of 30 | After a long gap, notifications past page 5 are missed, and recovery waits up to 30 min | S |
| 4 | **Session-expiry alert**: one Discord message per connection when a session expires | The new watchdog ignores expiry on purpose; you still need to reconnect | S |
| 5 | **Consistent client identity**: stop claiming Chrome 130 in `audience.ts` on server requests, or match it everywhere; test before rolling out | A browser user-agent on a non-browser connection is a mismatch | S, test first |

The lasting fix for the blocked sweeps is to run them from the browser (see
the extension section below).

We will not use rotating residential proxies, TLS-fingerprint spoofing or
CAPTCHA solvers. They defeat Substack's protection rather than stay under it,
and risk getting the account flagged.

## Automated extension publishing

Extend `.github/workflows/extension-release.yml` so a manifest version bump on
`main` also submits the same zip to the Chrome Web Store. The GitHub Release
stays as the sideload build.

1. **One-time, by hand:** publish the first Store version from the Developer
   Dashboard, with the Store listing and Privacy tabs complete.
   `extension/store-assets/` already holds the listing images.
2. **One-time credentials:** in Google Cloud, create an OAuth client with the
   `https://www.googleapis.com/auth/chromewebstore` scope, then get a refresh
   token from the OAuth 2.0 Playground as the account that owns the item. That
   account needs 2-step verification.
3. **GitHub secrets:** `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID` (Dashboard → Publisher → Settings),
   `CWS_EXTENSION_ID`.
4. **Workflow step after the release:** exchange the refresh token at
   `oauth2.googleapis.com/token`, then
   `POST .../upload/v2/publishers/$PUBLISHER/items/$ITEM:upload` with the zip,
   poll `:fetchStatus` while it reports `UPLOAD_IN_PROGRESS`, then
   `POST .../v2/publishers/$PUBLISHER/items/$ITEM:publish`. About 25 lines of
   `curl` and `jq`; no new dependency.

Each submission still goes through Google's review, so a release reaches users
hours to days after the push. Uploads fail unless the manifest version went
up, which the current workflow already enforces. Staged rollout
(`setPublishedDeployPercentage`) only works above 10,000 weekly users, so it
doesn't apply yet. Source:
[Chrome Web Store API docs](https://developer.chrome.com/docs/webstore/using-api).

## Extension: redesign and integration

Rework both how the extension looks and how it fits into browsing Substack,
so it feels like part of Circles rather than a separate tool.

**Today:** a dark popup (connection status, server pairing, Connect, and "Add
to Circles" for the profile in the current tab, with lists and tags). On
Substack pages it adds orange "Add" pills next to author names, plus a
list-picker modal. Its colors are hard-coded in `popup.css` and `substack.ts`,
separate from the web app's theme in `packages/ui`.

### Look

- **One design system:** build the popup and in-page UI from the web app's
  theme tokens, so the extension looks like Circles and follows the system
  light/dark setting.
- **Quieter in-page UI:** replace the bright orange pills with a small Circles
  chip sized like Substack's own buttons. Render it in a Shadow DOM so
  Substack's CSS and ours can't affect each other.
- **Popup layout:** once paired, collapse the status block to one line. The
  main area becomes the person on the current page.
- **Mockups first:** agree on 2–3 visual directions before writing code.

### Behavior

- **Side panel** (`chrome.sidePanel`): stays open while you browse and shows
  the contact for the current profile or Note author: scores, last touches,
  lists, tags and notes, editable in place.
- **Hover card** on author names: inbound/outbound score and which of your
  lists they're in.
- **Toolbar badge:** shows at a glance when pairing is missing, the Substack
  session has expired, or captures are queued.
- **Links both ways:** "Open in Circles" from the panel, "Open on Substack"
  from the web app.
- **Browser-run audience sweeps:** when the browser is idle, the extension
  reads the subscriber and following lists with your real session and posts
  them to `/api/ext`. The server sweep runs only if no browser sweep has
  landed in 48 h. This is the lasting fix for the 403s.

The panel, hover card and badge read only from the Circles API, so they add no
Substack requests. The browser-run sweeps do add Substack reads, which changes
the current rule that the extension never makes its own Substack requests
(see `AGENTS.md`, "Extension workflow").

## Order of work

1. **Worker quick wins:** 403 circuit breaker, jitter, outage catch-up,
   session-expiry alert. One PR, no extension change.
2. **Store publishing:** first manual Store release, credentials and secrets,
   then the workflow step. Needed before the extension redesign ships to
   users.
3. **Extension look:** mockups, then the shared theme and the Shadow DOM chip.
4. **Extension behavior:** toolbar badge, then side panel, then hover card.
5. **Browser-run audience sweeps:** last, once the panel and the new rule are
   agreed.
6. **Client identity (sync item 5):** test on its own, then roll out or drop.

## Open questions

- [ ] Should the side panel replace the popup, or sit alongside it?
- [ ] Approve changing the "no extension-initiated Substack reads" rule for
      audience sweeps?
- [ ] Is the Store listing public, unlisted or private? It decides who can
      install it, and later changes need one manual publish.
- [ ] Which visual direction: close to Substack's look, or clearly
      Circles-branded?
- [ ] Keep orange as the Circles accent in the extension, or tone it down?
