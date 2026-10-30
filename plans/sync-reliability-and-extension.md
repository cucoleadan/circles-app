# Sync reliability and extension plan

Status: 2026-10-30. Only open work is listed here; finished items are
removed as they land. Mirrors the shared Claude doc "Circles: sync
reliability and extension plan".

## Sync reliability

One worker change remains:

- **Consistent client identity**: stop claiming Chrome 130 in `audience.ts`
  on server requests, or match it everywhere. A browser user-agent on a
  non-browser connection is a mismatch. Test before rolling out.

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

The live design preview is the Claude artifact "Circles side panel preview".

### Remaining

- **Test browser reads in Chrome:** confirm the background's direct fetches
  carry the Circles login cookie, and that Substack accepts
  `POST subscriber-stats` from the extension. A refused read only hands that
  read back to the server.
- **In-page chip:** restyle the orange "Add" pills and the list modal in the
  app's look, rendered in a Shadow DOM so Substack's CSS and ours can't
  affect each other.
- **Hover card** on author names: inbound/outbound counts and lists.
- **Toolbar badge:** pairing missing, Substack session expired, or captures
  queued.
- **"Open on Substack"** from the web app's contact drawer.
- **More browser reads:** the reply-tree refreshes of recent Notes and posts,
  and pushing back the server's notifications poll after a passive capture of
  the activity feed.

## Substack email ingestion

Substack emails the account owner about new subscribers, unsubscribes,
comments, replies and more. Parsing them gives a second, independent record,
so nothing the API sweeps miss (or that a 403 blocks) goes unlogged.

- The worker receives each Substack notification email, keeps the raw message
  as evidence (like `activity_snapshots`), and parses it into the same
  canonical ingestion path (`packages/core/src/ingestion.ts`), so replays stay
  idempotent and an email and an API item for the same event converge.
- Event types to start with: new free/paid subscriber, unsubscribe, comment
  and reply on posts and Notes. Unknown templates are stored, not dropped,
  so a parser added later can replay them.
- Emails carry subscriber addresses: store them like `subscriber_emails`
  (browser-only, never in MCP or logs), and keep test fixtures synthetic.

Open: how mail reaches the worker. Options, simplest first:

1. **Forwarding to an inbound endpoint:** a mail filter forwards Substack's
   emails to an address on the Circles domain; Cloudflare Email Routing hands
   each message to a small Email Worker that posts it to an authenticated
   `/api/...` route, which queues a parse job. Push, no polling, no mailbox
   password on the server.
2. **IMAP polling:** the worker reads a dedicated mailbox or label on a
   schedule with an app password. Needs a new dependency and stored mail
   credentials.
3. **Gmail API:** OAuth with read access to one label. The most setup.

## Order of work

1. **Store setup:** first manual Store release, credentials and secrets.
   Needed before the extension redesign ships to users.
2. **Extension in-page UI:** Shadow DOM chip, then toolbar badge, then hover
   card.
3. **Client identity:** test on its own, then roll out or drop.
4. **Email ingestion:** pick the delivery path, then parsers per template.

## Decisions

- The side panel replaces the popup: the toolbar icon opens it.
- The extension looks exactly like the web app: same `packages/ui`
  components, theme and stone/`#f15a3a` styling, following the system
  light/dark setting.

## Open questions

- [ ] Is the Store listing public, unlisted or private? It decides who can
      install it, and later changes need one manual publish.
