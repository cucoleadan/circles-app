import { describe, expect, test } from "bun:test"

import { normalizeProfileFeed, parseRssFeed, postKey, publicationFeedUrl } from "../src/profile-content.js"

const profileId = "4878855"
const author = {
  id: 4878855, handle: "tracy",
  primary_publication: { id: 1, subdomain: "secondact", custom_domain_optional: false },
}
const context = (type: string, timestamp: string) => ({ type, timestamp, users: [author] })

describe("profile feed normalization", () => {
  const page = {
    items: [
      {
        type: "post", entity_key: "p-223", context: context("latest_post", "2026-11-02T18:18:42.711Z"),
        post: { id: 223, title: "Nobody cares", subtitle: "Yet", canonical_url: "https://secondact.substack.com/p/nobody-cares/", post_date: "2026-11-02T18:18:42.711Z" },
      },
      {
        type: "comment", entity_key: "c-384", context: context("note", "2026-11-11T23:09:00.142Z"),
        comment: { id: 384, user_id: 4878855, handle: "tracy", body: "A Note", date: "2026-11-11T23:09:00.142Z" },
      },
      {
        type: "comment", entity_key: "c-385", context: context("note", "2026-11-11T22:00:00.000Z"),
        comment: { id: 385, user_id: 4878855, handle: "tracy", body: "A reply", date: "2026-11-11T22:00:00.000Z", ancestor_path: "100.200" },
      },
      {
        type: "comment", entity_key: "c-900", context: context("comment_restack", "2026-11-10T09:00:00.000Z"),
        comment: { id: 900, user_id: 9001, handle: "alice", body: "Alice's Note", date: "2026-11-01T09:00:00.000Z" },
      },
      {
        type: "post", entity_key: "p-555", context: context("post_restack", "2026-11-09T09:00:00.000Z"),
        post: { id: 555, title: "Bob's post", canonical_url: "https://bob.substack.com/p/hello", post_date: "2026-10-01T09:00:00.000Z" },
      },
      // A chat prompt and a like are not content the profile wrote.
      { type: "chat", entity_key: "cp-1", context: context("chat_subscribed", "2026-11-11T16:02:23.345Z") },
      {
        type: "comment", entity_key: "c-901", context: context("note_like", "2026-11-10T08:00:00.000Z"),
        comment: { id: 901, user_id: 9002, body: "Liked" },
      },
    ],
  }

  test("keeps authored Notes, replies, restacks and posts, and nothing else", () => {
    const { items, publicationUrl } = normalizeProfileFeed(page, profileId)
    expect(publicationUrl).toBe("https://secondact.substack.com")
    expect(items.map((item) => [item.kind, item.externalId])).toEqual([
      ["post", "secondact.substack.com/p/nobody-cares"],
      ["note", "c-384"],
      ["reply", "c-385"],
      ["restack", "c-900"],
      ["restack", "p-555"],
    ])
    expect(items[1]).toMatchObject({
      body: "A Note", url: "https://substack.com/@tracy/note/c-384", publishedAt: "2026-11-11T23:09:00.142Z",
    })
    // A restack is dated when it was restacked and links to the original author.
    expect(items[3]).toMatchObject({
      url: "https://substack.com/@alice/note/c-900", publishedAt: "2026-11-10T09:00:00.000Z",
    })
    expect(items[0]).toMatchObject({ title: "Nobody cares", body: "Yet" })
  })

  test("tolerates an empty or malformed page", () => {
    expect(normalizeProfileFeed(null, profileId)).toEqual({ items: [], publicationUrl: null })
    expect(normalizeProfileFeed({ items: [null, {}, { context: {} }] }, profileId).items).toEqual([])
  })
})

describe("publication RSS", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>Second Act</title>
    <item><title><![CDATA[Nobody cares & why]]></title>
      <description><![CDATA[<p>First&nbsp;line</p><p>Second</p>]]></description>
      <link>https://secondact.substack.com/p/nobody-cares</link>
      <guid isPermaLink="false">https://secondact.substack.com/p/nobody-cares</guid>
      <dc:creator><![CDATA[Tracy]]></dc:creator>
      <pubDate>Mon, 02 Nov 2026 18:18:42 GMT</pubDate></item>
    <item><title>Plain &amp; simple</title><link>https://secondact.substack.com/p/plain</link></item>
    <item><title>No link</title></item>
    <item><title>Not https</title><link>http://secondact.substack.com/p/old</link></item>
  </channel></rss>`

  test("reads posts keyed like the profile feed's", () => {
    const items = parseRssFeed(xml)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: "post", externalId: "secondact.substack.com/p/nobody-cares", title: "Nobody cares & why",
      body: "First line Second", publishedAt: "2026-11-02T18:18:42.000Z",
    })
    expect(items[1]).toMatchObject({ title: "Plain & simple", publishedAt: null })
    expect(postKey("https://SecondAct.substack.com/p/nobody-cares/?utm=1")).toBe(items[0]!.externalId)
  })

  test("builds a feed URL only for public https hosts", () => {
    expect(publicationFeedUrl("https://secondact.substack.com/about")).toBe("https://secondact.substack.com/feed")
    expect(publicationFeedUrl("www.example-writer.com")).toBe("https://www.example-writer.com/feed")
    for (const unsafe of [
      null, "", "http://secondact.substack.com", "https://localhost", "https://10.0.0.5", "https://[::1]",
      "https://db.internal", "https://intranet", "https://user:pw@secondact.substack.com", "https://secondact.substack.com:8443",
    ]) expect(publicationFeedUrl(unsafe)).toBeNull()
  })
})
