# Circles HTTP API

Every tool the [Circles MCP server](mcp.md) offers is also available as a plain
JSON endpoint. You can call it from scripts, cron jobs, Zapier/n8n, or your own
backend. You don't need an MCP client or an OAuth flow: create a key in the
dashboard and send it in a header.

The API runs each request through the same tool code as MCP, so the data,
permissions, caching and limits are the same on both.

## Quick start

1. Sign in to Circles and open **`/mcp`** (Connection settings → Connected
   agents).
2. Under **API keys**, enter a name, choose permissions, and click **Create API
   key**. Copy the key (`ck_...`). It is shown only once.
3. Call a tool:

```bash
curl -X POST https://circles.example.com/api/tools/circles_get_overview \
  -H "Authorization: Bearer $CIRCLES_API_KEY"
```

```json
{ "data": { "...": "..." } }
```

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/openapi.yaml` | none | OpenAPI 3.1 spec for every tool |
| `GET` | `/api/tools` | key | Tools this key can call, with their input schemas |
| `POST` | `/api/tools/<tool>` | key | Run a tool; the JSON body holds its arguments |

The spec is generated from the running server's tool list, so it always
matches what is deployed. Import it into Postman, Insomnia, or an OpenAPI
client generator:

```bash
curl -o circles-openapi.yaml https://circles.example.com/api/openapi.yaml
```

### Calling a tool

The request body is the tool's arguments as a JSON object. An empty body means
`{}`. Arguments are validated against the tool's schema.

```bash
# Contacts waiting for a reply
curl -X POST https://circles.example.com/api/tools/circles_list_people \
  -H "Authorization: Bearer $CIRCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"view": "needs-reply", "limit": 20}'

# Today's agenda
curl -X POST https://circles.example.com/api/tools/circles_get_day_brief \
  -H "Authorization: Bearer $CIRCLES_API_KEY" \
  -d '{"date": "2026-11-18", "timeZone": "Europe/London"}'
```

JavaScript (server-side):

```js
async function circles(tool, args = {}) {
  const response = await fetch(`https://circles.example.com/api/tools/${tool}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CIRCLES_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${body.error}`)
  return body.data
}

const { people } = await circles("circles_list_people", { view: "needs-reply" })
```

Python:

```python
import os, requests

def circles(tool, **args):
    r = requests.post(f"https://circles.example.com/api/tools/{tool}",
                      headers={"Authorization": f"Bearer {os.environ['CIRCLES_API_KEY']}"},
                      json=args, timeout=60)
    body = r.json()
    if not r.ok:
        raise RuntimeError(f"{r.status_code}: {body['error']}")
    return body["data"]

people = circles("circles_list_people", view="needs-reply")["people"]
```

### Responses

A successful call returns `200`:

```json
{ "data": { ... }, "meta": { ... } }
```

`data` is the tool's result. `meta` appears only on Substack reads and holds
`circles/fetchedAt` and `circles/cached`.

Errors always return `{ "error": "<message>" }`:

| Status | Meaning |
| --- | --- |
| `400` | The body is not a JSON object, or the arguments don't match the tool's schema |
| `401` | The key is missing, malformed, unknown or revoked |
| `403` | The key lacks a permission the tool (or a raw/records argument) needs |
| `404` | No tool with that name exists |
| `422` | The tool ran and failed, e.g. a contact was not found or no Substack account is connected |
| `429` | Rate limit reached; wait `Retry-After` seconds |
| `503` | Authentication is temporarily unavailable (database down); retry later |

## Tools

There are two groups. The [MCP docs](mcp.md#tools-and-data-sources) and the
OpenAPI spec describe each tool.

- **`circles_*`**: your CRM. Contacts, interactions, lists and tags, received
  comments, Note drafts and scheduling, sync status, the day brief. They read
  and write the Circles database and never call Substack unless the
  description says so.
- **Substack reads** (`get_post_analytics`, `get_subscriber_stats`,
  `get_profile_notes` and others): live reads through your connected Substack
  account.

### Substack reads are cached and may be asynchronous

A Substack read returns the server's cached copy if it is less than 6 hours
old. The cache is shared with your MCP agents. Pass `"refresh": true` only when
you need live data; a copy less than 10 minutes old is still reused.

If a live read doesn't finish within about 20 seconds, the call returns:

```json
{ "data": { "runId": "…", "status": "pending", "pollTool": "circles_get_tool_run" } }
```

Poll it every few seconds until `data.result` is present:

```bash
curl -X POST https://circles.example.com/api/tools/circles_get_tool_run \
  -H "Authorization: Bearer $CIRCLES_API_KEY" -d '{"runId": "…"}'
```

At most 10 Substack reads can be queued per account at once.

## Permissions

You choose a key's permissions when you create it. They can't be changed
later: to change them, create a new key and revoke the old one. Only read
permissions are pre-selected.

| Permission | Allows |
| --- | --- |
| `circles:read` | CRM data, private contact notes, comments, drafts and scheduled Notes, status and briefings |
| `circles:organize` | Editing contacts, lists, tags, queue settings and comment triage |
| `circles:notes:write` | Creating and editing Note drafts and uploading images |
| `circles:notes:publish` | Scheduling, rescheduling, unscheduling and publishing Notes |
| `circles:sync` | Refreshing Substack data and managing historical imports |
| `circles:delete` | Deleting Notes, lists and tags (together with that area's permission) |
| `substack:read` | Live Substack content, account and publication analytics |
| `substack:records` | Raw analytics rows and subscriber records, including personal data |

`GET /api/tools` lists only the tools a key can call. Calling any other tool
returns `403`.

Publishing follows the app's rules: "post now" waits 60 seconds so it can be
aborted, and scheduling is limited to 92 days ahead. Subscriber email
addresses from Newsletter Signals are never available through the API.

## Limits

- **120 calls per minute per key.** The budget is shared between `/api/tools`
  and `/api/mcp`. Going over returns `429` with a `Retry-After` header.
- 24 MB request bodies; `circles_upload_note_image` takes base64 images up
  to 15 MB.
- Substack reads have a four-minute budget and a 2 MB result limit.
- 20 API keys per account.

## Security

- **Treat a key like a password.** It acts as you, with the permissions you
  chose. Keep it in a secret store or environment variable, and never put it
  in browser code, a mobile app or a git repository. The API sends no CORS
  headers, so web pages on other sites can't call it.
- **Keys are stored hashed.** Circles keeps only a SHA-256 hash and can't show
  a key again. If you lose one, revoke it and create a new one.
- **Revocation is immediate.** "Revoke access" on `/mcp` invalidates the key
  for the API, for MCP, and for any Substack reads it already queued.
- **Creating a key needs a recent sign-in** (within 24 hours), so a stolen old
  session cookie can't mint a long-lived key.
- **Keys don't expire,** and signing out doesn't revoke them. Revoke keys you
  no longer use. `/mcp` shows when each key was last used.
- **Use the narrowest permissions.** A reporting script needs only
  `circles:read`, plus `substack:read` for Substack analytics.
- Write calls are recorded in the account's audit log under the key's client
  ID.

## Using a key with MCP

A key also works as a static bearer token on `/api/mcp`. This helps with MCP
gateways that support a fixed `Authorization` header but not OAuth:

```
URL:     https://circles.example.com/api/mcp
Header:  Authorization: Bearer ck_...
```

OAuth remains the better choice for interactive clients such as Claude, ChatGPT
and Cursor, because the user grants each permission on a consent screen.

## Self-hosting notes

- The API is part of `apps/api`; no extra service or environment variable is
  needed. The `042_api_keys.sql` migration runs automatically on deploy.
- `APP_URL` sets the server URL written into the OpenAPI spec.
- Route `/api/*` to the API service (the same rule MCP uses).
- The rate limit is kept in memory per API process. If you run several API
  replicas, each one counts separately.
- How it works: each key is a first-party OAuth client with its own consent
  record, so the MCP grant checks, the Substack-read worker and revocation
  apply to keys with no separate code path. See
  [`apps/api/src/routes/api.ts`](../apps/api/src/routes/api.ts) and
  [`apps/api/src/mcp/auth.ts`](../apps/api/src/mcp/auth.ts).
