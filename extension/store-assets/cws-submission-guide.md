# Chrome Web Store Submission Guide (Unlisted)

This guide provides the exact fields, copy-paste descriptions, and permission justifications needed to submit **Circles Companion** to the Chrome Web Store Developer Dashboard as an **Unlisted** extension for your team.

---

## 1. Account Settings: Publisher Email Verification

*In the left navigation menu, click **Account** or **Settings**:*
1. **Contact Email**: Enter your email address (e.g., `cucoleadan@gmail.com`).
2. Click **Verify email** / **Send verification link**.
3. Open your inbox, click the verification link from Google to activate your developer profile.

---

## 2. Store Listing Tab

### Extension Details
* **Name**: `Circles Companion`
* **Summary**: `Connects your Substack session to Circles CRM and adds people to your lists.`
* **Category**: `Productivity` (or `Social & Communication`)
* **Language**: `English`

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
* **Store Icon**: `extension/store-assets/store-icon-128.png` (Matches your Circles concentric circles SVG).
* **Screenshots**: `extension/store-assets/screenshot-1280x800.png` (24-bit RGB, no alpha).
* **Small Promo Tile**: `extension/store-assets/promo-tile-440x280.png` (24-bit RGB, no alpha).

---

## 3. Privacy Practices Tab (Required Justifications)

### Single Purpose Description
```text
The single purpose of Circles Companion is to connect a user's authenticated Substack browsing session to their private Circles CRM instance, allowing them to organize contacts into lists and sync conversation timelines.
```

### Permission Justifications

#### `alarms`
```text
Used to schedule periodic background tasks that drain and retry queued outbound Substack interactions (likes, restacks, comments) to ensure data reaches the user's CRM even during network fluctuations.
```

#### `cookies`
```text
Used solely to read the user's active Substack session cookie (substack.sid) so their private Circles CRM instance can verify account ownership and synchronize authorized feeds without requiring the user to share their Substack password.
```

#### `host_permissions`
```text
Required on https://*.substack.com/* to inject in-page quick-action buttons ('+ Circles') and passively observe feed responses so conversation threads are captured without generating extra rate-limited requests. Also required on https://circles.mhntwrkdan.dev/* to securely transmit contact list additions and engagement data to the user's private CRM backend over HTTPS.
```

#### `storage`
```text
Used locally in the browser to store extension preferences, publication connection status, and offline retry queues for outbound CRM interactions.
```

#### Remote Code
* Select: **No, I am not using remote code**
*(If a text justification is requested):*
```text
This extension does not use any remote code. All scripts and assets are packaged and executed locally within the extension bundle.
```

### Data Usage Declarations & Checkboxes
- [x] **Authentication information**: Yes (`substack.sid` session token)
- [x] **User activity**: Yes (Outbound likes, restacks, comments)
- [x] **Website content**: Yes (Substack author handles and thread comments)

### Policy Certification Checkboxes
Check all 3 compliance certifications at the bottom:
- [x] "I certify that my extension does not sell or transfer user data..."
- [x] "I certify that my extension does not use or transfer user data for personalized advertising..."
- [x] "I certify that my extension does not use or transfer user data to determine creditworthiness..."

### Privacy Policy URL
```text
https://circles.mhntwrkdan.dev/privacy
```

---

## 4. Distribution Tab

1. Under **Visibility**, select:
   * **Unlisted** ("Anyone with the link can install")
2. Click **Save draft**, then click **Submit for review**.
