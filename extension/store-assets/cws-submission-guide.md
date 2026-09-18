# Chrome Web Store Submission Guide (Unlisted)

This guide provides the exact fields, copy-paste descriptions, and permission justifications needed to submit **Circles Companion** to the Chrome Web Store Developer Dashboard as an **Unlisted** extension for your team.

---

## 1. Access the Chrome Web Store Developer Dashboard

1. Visit [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with your Google account.
3. If this is your first time, accept the developer agreement and pay the one-time **$5 USD** registration fee.
4. Click **"Add new item"** (or "Upload new package").
5. Drag and drop `extension/circles-companion-0.2.5.zip`.

---

## 2. Store Listing Tab

### Extension Details
* **Name**: `Circles Companion`
* **Summary (up to 132 chars)**:
  ```text
  Connects your Substack session to Circles CRM and adds people to your lists.
  ```
* **Category**: `Productivity` (or `Social & Communication`)

### Detailed Description
Paste the following into the description box:

```text
Circles Companion is a companion browser extension for Circles CRM (https://circles.mhntwrkdan.dev).

It bridges your authenticated Substack session to your private Circles workspace so you can manage reader and creator relationships seamlessly:

• Instant List Management: Click "+ Circles" beside any Substack author or commenter to add them directly to your CRM lists and tags.
• Conversation Sync: Passively maps engagement threads, notes, and discussions so your CRM relationship timeline is always up-to-date.
• Outbound Interaction Tracking: Automatically records your likes, restacks, and replies to keep your relationship scores accurate.
• Zero Password Sharing: Uses your active browser session cookie to authenticate directly with your private CRM instance without sharing credentials.

DISCLAIMER:
Circles Companion is an independent tool built for Circles CRM users. It is not affiliated with, endorsed by, or sponsored by Substack, Inc.
```

### Graphic Assets
* **Store Icon**: Upload `extension/store-assets/store-icon-128.png` (128×128 PNG).
* **Small Promo Tile**: Upload `extension/store-assets/promo-tile-440x280.png` (440×280 PNG).
* **Screenshots**: Upload 1 to 5 screenshots (1280×800 or 640×400 PNG).
  * *Tip*: Take a screenshot of the Circles popup and a Substack page showing the "+ Circles" button next to a note author.

---

## 3. Privacy Tab (Crucial for Fast Approval)

Google manually reviews privacy declarations. Fill these out exactly as described:

### Single Purpose Description
```text
The single purpose of Circles Companion is to connect a user's authenticated Substack browsing session to their private Circles CRM instance, allowing them to organize contacts into lists and sync conversation timelines.
```

### Permission Justifications

#### `cookies`
```text
Used solely to read the user's active Substack session cookie (substack.sid) so their private Circles CRM instance can verify account ownership and synchronize authorized feeds without requiring the user to expose their Substack password.
```

#### `host_permissions` (`https://*.substack.com/*`)
```text
Required to inject in-page quick-action buttons ('+ Circles') next to author handles on Substack and passively observe incoming feed responses so conversation threads are captured without generating extra, rate-limited network requests.
```

#### `host_permissions` (`https://circles.mhntwrkdan.dev/*`)
```text
The user's private Circles CRM host. Required to transmit captured contact list additions, engagement metrics, and session verification directly to their CRM backend over HTTPS.
```

### Data Usage Declarations
In the Developer Console checkboxes for data collection:
- [x] **Authentication information**: Yes
  - *Data type*: Personal identification & credentials (`substack.sid` session token).
  - *Usage*: Link Substack publication to private Circles CRM.
- [x] **User activity**: Yes
  - *Data type*: Network monitoring & clicks (Passive capture of Substack engagement actions: likes, restacks, comments).
  - *Usage*: Maintain chronological relationship timelines in CRM.
- [x] **Website content**: Yes
  - *Data type*: Substack author handles and thread comments.
  - *Usage*: Contact list management.

### Chrome Web Store Policies Certification
Check all 3 compliance checkboxes:
- [x] "I certify that my extension does not sell or transfer user data to third parties..."
- [x] "I certify that my extension does not use or transfer user data for personalized advertising..."
- [x] "I certify that my extension does not use or transfer user data to determine creditworthiness or for lending purposes."

### Privacy Policy URL
```text
https://circles.mhntwrkdan.dev/privacy
```

---

## 4. Distribution Tab

1. Under **Visibility**, select:
   * **Unlisted** ("Anyone with the link can install")
2. Under **Distribution**, leave as standard / worldwide.
3. Under **Pricing & Payments**, select **Free**.

---

## 5. Submit for Review

1. Click **Submit for Review**.
2. Review duration for unlisted extensions is typically **24 to 72 hours**.
3. Once approved:
   - Google assigns a permanent URL format:
     `https://chromewebstore.google.com/detail/circles-companion/<extension_id>`
   - Share this link with your team.
   - Any future version updates you publish (via `bun run pack` in `extension/`) will automatically roll out in the background to all team members within a few hours!
