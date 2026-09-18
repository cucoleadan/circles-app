# Authenticated Substack profile-feed support

## Objective

Extend `unofficial-substack-sdk` with complete, paginated access to the
authenticated Substack profile feed.

The SDK currently exposes profile Notes, but it does not expose the general
profile feed or the profile's authored replies feed. These feeds contain useful
history that is otherwise discarded, including authored comments/replies and
active Note and post restacks.

The current consumer version is `unofficial-substack-sdk@0.3.14`. Implement
this as the next patch release, expected to be `0.3.15`.

## Confirmed endpoints

### General profile feed

```http
GET https://substack.com/api/v1/reader/feed/profile/{profileId}
```

This endpoint is authenticated with the existing `substack.sid` session
cookie. It returns a paginated, mixed feed rather than only profile metadata.

Observed feed entries include:

- Authored Notes: `context.type = "note"`, `context.source = "db-note"`
- Note restacks: `context.type = "comment_restack"`,
  `context.source = "db-restack"`
- Authored posts: `context.type = "post"`, `context.source = "db-post"`
- Post restacks: `context.type = "post_restack"`,
  `context.source = "db-restack"`

The unfiltered endpoint must remain available because a filtered restack feed
may not return every kind of restack.

### Authored replies and comments

```http
GET https://substack.com/api/v1/reader/feed/profile/{profileId}?types%5B%5D=replies
```

Decoded query string:

```text
types[]=replies
```

This is the feed used by profile pages such as:

```text
https://substack.com/@{handle}/replies
```

It includes comments and replies authored by the profile, including activity
on other people's content.

Substack expects an array-style query parameter. Do not serialize this as
`types=replies` or as a comma-separated string.

### Profile Notes

The SDK already supports profile Notes through the profile feed. Confirm the
exact request made by the current `getProfileNotes()` implementation and, if
appropriate, refactor it to use the new generic feed method without changing
its public behavior.

The expected array-style filter is:

```text
types[]=note
```

### Public profile metadata

Endpoints in the following family return profile/account metadata rather than
the complete activity history:

```http
GET https://substack.com/api/v1/user/{handle}/public_profile
GET https://substack.com/api/v1/user/{profileId}-{slug}/public_profile/self
```

Fields may include `id`, `handle`, `name`, `hasActivity`, `hasLikes`,
`hasPosts`, subscriptions, publication information, and profile settings.
These responses must not be treated as substitutes for the paginated reader
profile feed.

## Current SDK gaps

At version `0.3.14`:

- `getProfileNotes()` exposes only the filtered Notes feed.
- `getProfileById()` requests the unfiltered profile feed to discover a
  handle, then fetches public profile metadata. It discards the feed entries.
- There is no public method for retrieving an unfiltered profile-feed page.
- There is no public method for retrieving authored replies/comments.
- Feed response and item variants are not fully represented by exported
  TypeScript types.
- Restack feed entries are not modeled as first-class response variants.

## Required API

Add a general paginated method similar to:

```ts
getProfileFeed(
  profileId: string | number,
  options?: {
    cursor?: string;
    limit?: number;
    types?: ProfileFeedFilter[];
  },
): Promise<ProfileFeedPage>
```

Add a convenience method for authored replies:

```ts
getProfileReplies(
  profileId: string | number,
  options?: {
    cursor?: string;
    limit?: number;
  },
): Promise<ProfileFeedPage>
```

`getProfileReplies()` must delegate to the generic method using:

```ts
types: ["replies"]
```

Optionally refactor `getProfileNotes()` to delegate to the generic method with
`types: ["note"]`, provided that this is backward compatible.

Follow the SDK's established cursor and response naming conventions. If the
upstream response uses more than one cursor field, preserve the raw fields and
document which one callers should provide on the next request.

## Query serialization

Every requested type must be encoded as a repeated `types[]` parameter:

```text
types[]=replies
types[]=note
```

For multiple values, the URL must contain repeated keys:

```text
types[]=note&types[]=replies
```

Cursor and limit parameters must use the names already accepted by the
Substack endpoint and used by the existing SDK implementation. Inspect the
current request code instead of introducing a second pagination convention.

## TypeScript models to add

Export the public request and response types from the package entry point.
Avoid narrowing the response so aggressively that undocumented upstream
fields are lost.

A suitable starting point is:

```ts
export type ProfileFeedFilter =
  | "note"
  | "replies"
  | (string & {});

export interface ProfileFeedPage {
  items: ProfileFeedItem[];
  nextCursor?: string | null;
  [key: string]: unknown;
}

export interface ProfileFeedContext {
  type?: string;
  source?: string;
  timestamp?: string;
  fallbackUrl?: string;
  [key: string]: unknown;
}

export interface ProfileFeedItemBase {
  context?: ProfileFeedContext;
  publication?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProfileNoteFeedItem extends ProfileFeedItemBase {
  comment: Record<string, unknown>;
}

export interface ProfileNoteRestackFeedItem extends ProfileFeedItemBase {
  comment: Record<string, unknown>;
}

export interface ProfilePostFeedItem extends ProfileFeedItemBase {
  post: Record<string, unknown>;
}

export interface ProfilePostRestackFeedItem extends ProfileFeedItemBase {
  post: Record<string, unknown>;
}

export type ProfileFeedItem =
  | ProfileNoteFeedItem
  | ProfileNoteRestackFeedItem
  | ProfilePostFeedItem
  | ProfilePostRestackFeedItem
  | ProfileFeedItemBase;
```

These names are illustrative. Adapt them to the SDK's existing naming and type
style. Prefer useful discriminated unions when the real payload supplies
stable discriminants, but retain an unknown/fallback variant because this is
an undocumented upstream API.

Do not discard these fields when present:

- `comment`
- `post`
- `publication`
- `context`
- `context.type`
- `context.source`
- `context.timestamp`
- `context.fallbackUrl`
- `publishedBylines`
- pagination cursor fields

## Observed author locations

Callers need enough raw information to identify the author whose content was
restacked or replied to.

### Note restack

For `comment_restack` / `db-restack` entries, the target Note is normally in
`item.comment`. Its author fields may include:

```text
comment.user_id
comment.name
comment.handle
comment.photo_url
```

### Post restack

For `post_restack` / `db-restack` entries, the target is in `item.post`.
The author is commonly available from:

```text
post.publishedBylines[0]
```

Publication-level fallbacks may include:

```text
publication.author_id
publication.author_handle
publication.author_name
publication.primary_user_id
```

These are documentation notes only. The SDK should return the full upstream
payload rather than applying application-specific normalization.

## Endpoints and filters requiring further investigation

Document these separately as unconfirmed behavior. Do not present an empty
response as proof that a feature never exists.

### Restack filter

A request using a singular query form such as `types=restack` has been observed
to return Note-restack items, but it did not establish whether post restacks
are included. Test the correct array form:

```text
types[]=restack
```

Compare the result against the unfiltered profile feed. If it omits
`post_restack` entries, document that callers must paginate the unfiltered feed
to obtain both Note and post restacks.

### Likes

No complete historical likes endpoint has been confirmed. The public-profile
field `hasLikes` is metadata and is not a historical likes collection.

Investigate network traffic from any profile Likes UI if such a UI is
available. Do not invent a method or claim historical coverage without a
repeatable endpoint and fixture.

### Other possible filters

Singular forms such as the following have returned empty results in limited
testing:

```text
types=comment
types=reply
types=comment_reply
```

This does not invalidate the confirmed array-form replies endpoint:

```text
types[]=replies
```

Test array-form filters independently and document the exact request and
observed response before adding them to the public filter union.

## Authentication and safety

- Reuse the SDK's existing authenticated request mechanism.
- Send the session through the existing `substack.sid` cookie handling.
- Never log, return, interpolate into an error, or otherwise expose the session
  token.
- Preserve the SDK's existing error types and status-code behavior.
- Validate `profileId`, cursor, limit, and filter values consistently with the
  rest of the SDK.
- Do not add application-specific data normalization to the SDK.

## Tests

Add request and response tests covering all of the following:

1. An unfiltered call requests `/reader/feed/profile/{profileId}`.
2. Replies use the exact `types[]=replies` query parameter.
3. Notes use the correct array parameter if `getProfileNotes()` is refactored.
4. Cursor and limit are encoded using the established API parameter names.
5. Multiple type filters become repeated `types[]` parameters.
6. Feed items are returned without dropping unknown fields.
7. The next cursor and any other pagination metadata are retained.
8. Fixtures cover each observed feed variant:
   - authored Note;
   - Note restack;
   - authored post;
   - post restack;
   - authored reply/comment.
9. Existing `getProfileNotes()` behavior remains backward compatible.
10. Authentication and HTTP errors still use the SDK's existing error model.

Tests should assert URL/query behavior structurally where possible instead of
depending on query-parameter ordering.

## Documentation

Update the SDK README or API reference with examples for the generic feed and
the replies convenience method.

### General feed example

```ts
const page = await client.getProfileFeed(44242110, { limit: 20 });

for (const item of page.items) {
  console.log(item.context?.type, item.context?.source);
}
```

### Replies pagination example

```ts
let cursor: string | undefined;

do {
  const page = await client.getProfileReplies(44242110, {
    cursor,
    limit: 20,
  });

  for (const item of page.items) {
    // Process the authored reply/comment without losing its raw context.
  }

  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

Adjust the examples if the existing SDK uses a different cursor property, but
keep them runnable and consistent with the released API.

## Completion and release checklist

- [ ] General profile-feed method implemented and exported
- [ ] Authored-replies convenience method implemented and exported
- [ ] `types[]` serialization verified
- [ ] Cursor pagination verified
- [ ] Feed response/item types exported
- [ ] Unknown upstream fields preserved
- [ ] Existing Notes API remains compatible
- [ ] Restack filter behavior investigated and documented
- [ ] Likes endpoint status documented honestly
- [ ] Unit/request tests added
- [ ] README/API documentation updated
- [ ] Tests pass
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Build passes
- [ ] Package version bumped from `0.3.14` to `0.3.15`
- [ ] Changes committed and pushed
- [ ] Existing repository release workflow completed so the new version is
      installable

If publishing is performed by a tag or CI workflow, use that established
workflow instead of introducing a new manual publishing process.

## Required final report

After implementation, report:

- The exact exported method signatures
- The final request and response type names
- The cursor fields used for pagination
- Which profile-feed filters were confirmed
- Which endpoints or filters remain unknown/unavailable
- The test, typecheck, lint, and build results
- The released package version
- The commit hash
- Whether the package was published, tagged for release, or only pushed
