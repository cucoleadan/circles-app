# Circles Companion privacy policy

Effective date: September 18, 2026. Last updated: October 30, 2026.

## 1. Overview

Circles Companion ("the extension") is the browser companion to Circles, a
private, self-hosted relationship CRM for a Substack account. The extension
connects the user's Substack account to the Circles server that the user runs
or chooses, and shows that CRM in Chrome's side panel.

The extension has no server of its own. Everything it collects goes to one
place: the Circles server the user pairs in the side panel. The developer of
the extension receives no user data.

## 2. Data the extension accesses

**A. Substack session cookie.** When the user connects their Substack account,
the extension reads the `substack.sid` session cookie and sends it to the
user's Circles server, so that server can read the user's Substack data. The
extension never asks for or stores a Substack password.

**B. Engagement and conversations seen while browsing.** While the user browses
Substack, the extension reads the responses Substack already sends to the page
for notifications, comments and conversation threads. It also records actions
the user takes (likes, restacks, comments and replies) so the CRM timeline
reflects the user's interactions.

**C. Background sync with the user's own session.** While Chrome is open, the
extension reads the user's own Substack notifications about every 10 minutes
and, about once a day, the list of accounts the user follows and their
publication's subscriber list (names, profile IDs, subscription dates, plans
and email addresses). It does this only when the Substack account signed in to
Chrome is the one connected to the user's Circles server.

**D. Lists and tags.** When the user adds someone to the CRM from a Substack
page or the side panel, the extension sends the lists, tags and notes the user
chooses.

**E. The current tab.** The side panel reads the address of the active tab to
show the CRM contact for the Substack profile being viewed. Browsing history is
not recorded or sent anywhere.

## 3. How data is used

Data is used only to:

- connect the user's Substack account to their Circles CRM;
- build contact records, conversation timelines and relationship statistics;
- maintain the user's lists, tags, notes and follow-up queues.

The extension does not sell, rent or share data with third parties, does not
use it for advertising or profiling, does not use it to assess
creditworthiness, and does not use it to train machine learning models.

## 4. Storage and transmission

Data travels over HTTPS directly between the browser, Substack, and the
user's Circles server. The extension stores locally only its settings, the
paired server address, connection status, a retry queue of captures not yet
delivered, and its sync schedule. Data on the Circles server is held in that
server's database, under the control of whoever runs it.

## 5. Permissions

- `cookies`: read the Substack session cookie to connect the user's account.
- `storage`: keep the local settings, retry queue and sync schedule above.
- `alarms`: wake the extension once a minute to deliver queued captures and run
  the background sync when it is due.
- `scripting`: register the bridge script only on the Circles server the user
  pairs.
- `sidePanel`: open Circles in Chrome's side panel from the toolbar icon.
- `https://*.substack.com/*`: show quick-add buttons on Substack, capture the
  user's own activity, and run the background sync.
- Optional `https://*/*`: never granted at install. When the user enters their
  Circles server address, Chrome asks them to allow that one site only.

## 6. Your control

The user can stop all collection at any time by revoking the Substack
connection in Circles Settings, or by removing the extension at
`chrome://extensions`. Data already sent to a Circles server is deleted by
whoever operates that server.

## 7. Chrome Web Store User Data Policy

The extension's use of information received from Chrome APIs complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data/),
including the Limited Use requirements.

## 8. Contact

Questions about the extension: open an issue at
<https://github.com/cucoleadan/circles-app/issues>. Questions about data held
on a Circles server: contact the operator of that server.
