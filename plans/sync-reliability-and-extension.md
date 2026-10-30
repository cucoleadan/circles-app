# Sync reliability and extension plan

Status: 2026-10-30. The worker quick wins (403 circuit breaker, jitter,
outage catch-up, session-expiry alert) and the Store workflow step are built;
what remains is below. Mirrors the shared Claude doc "Circles: sync
reliability and extension plan".

## Sync reliability

One worker change remains:

- **Consistent client identity**: stop claiming Chrome 130 in `audience.ts`
  on server requests, or match it everywhere. A browser user-agent on a
  non-browser connection is a mismatch. Test before rolling out.

The lasting fix for the challenged audience sweeps is to run them from the
browser (see the extension section below).

We will not use rotating residential proxies, TLS-fingerprint spoofing or
CAPTCHA solvers. They defeat Substack's protection rather than stay under it,
and risk getting the account flagged.

## Chrome Web Store publishing

`.github/workflows/extension-release.yml` submits each release zip to the
Store and skips that step while the `CWS_*` secrets are missing. Remaining
one-time setup, by hand:

1. Publish the first Store version from the Developer Dashboard, with the
   Store listing and Privacy tabs complete. `extension/store-assets/` already
   holds the listing images.
2. In Google Cloud, create an OAuth client with the
   `https://www.googleapis.com/auth/chromewebstore` scope, then get a refresh
   token from the OAuth 2.0 Playground as the account that owns the item. That
   account needs 2-step verification.
3. Add the GitHub secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID` (Dashboard → Publisher → Settings)
   and `CWS_EXTENSION_ID`.

Each submission still goes through Google's review, so a release reaches users
hours to days after the push.

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

1. **Store setup:** first manual Store release, credentials and secrets.
   Needed before the extension redesign ships to users.
2. **Extension look:** mockups, then the shared theme and the Shadow DOM chip.
3. **Extension behavior:** toolbar badge, then side panel, then hover card.
4. **Browser-run audience sweeps:** last, once the panel and the new rule are
   agreed.
5. **Client identity:** test on its own, then roll out or drop.

## Open questions

- [ ] Should the side panel replace the popup, or sit alongside it?
- [ ] Approve changing the "no extension-initiated Substack reads" rule for
      audience sweeps?
- [ ] Is the Store listing public, unlisted or private? It decides who can
      install it, and later changes need one manual publish.
- [ ] Which visual direction: close to Substack's look, or clearly
      Circles-branded?
- [ ] Keep orange as the Circles accent in the extension, or tone it down?
