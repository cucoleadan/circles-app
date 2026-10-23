import { describe, expect, test } from "bun:test"
import { deflateRawSync } from "node:zlib"

import { computeNewsletterSignals, isNewsletterSignalsFile, parseCsv, readZipEntries } from "../src/newsletter-export.js"

// Synthetic data only: this repository is public.
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = deflateRawSync(Buffer.from(text))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const posts = "post_id,post_date,is_published,email_sent_at,inbox_sent_at,type,audience,title,subtitle,podcast_url\n" +
  "100.first-post,2026-01-01T00:00:00Z,true,2026-01-01T10:00:00Z,,newsletter,everyone,\"First, with \"\"quotes\"\"\",,\n" +
  "200.second-post,2026-01-08T00:00:00Z,true,2026-01-08T10:00:00Z,,newsletter,everyone,Second,,\n"
const delivers = (postId: string, day: string, emails: string[]) =>
  "post_id,timestamp,email,post_type,post_audience,active_subscription\n" +
  emails.map((email) => `${postId},2026-01-${day}T10:00:00Z,${email},newsletter,everyone,true`).join("\n")
const opens = (postId: string, day: string, emails: string[]) =>
  "post_id,timestamp,email,post_type,post_audience,active_subscription,country,city,region,device_type,client_os,client_type,user_agent\n" +
  emails.map((email) => `${postId},2026-01-${day}T12:00:00Z,${email},newsletter,everyone,true,XX,Town,RG,desktop,os,client,"Agent, 1.0"`).join("\r\n")

describe("newsletter export signals", () => {
  test("parses quoted CSV fields and a byte-order mark", () => {
    expect(parseCsv("﻿a,b\n\"x, \"\"y\"\"\",2\n")).toEqual([{ a: "x, \"y\"", b: "2" }])
  })

  test("reads only the wanted entries from a deflated zip", () => {
    const entries = readZipEntries(zip({ "posts.csv": "a\n1", "posts/1.slug.html": "<p>" }), isNewsletterSignalsFile)
    expect([...entries.keys()]).toEqual(["posts.csv"])
    expect(entries.get("posts.csv")!.toString()).toBe("a\n1")
  })

  test("computes per-post and per-subscriber engagement", () => {
    const archive = zip({
      "posts.csv": posts,
      "email_list.sample.csv": "email,active_subscription,expiry,plan,email_disabled,created_at,first_payment_at\n" +
        "Reader.A@example.com,true,,paid,false,2025-12-01T00:00:00Z,\nreader.b@example.com,false,,free,false,2025-12-02T00:00:00Z,\nlurker@example.com,false,,free,false,,\n",
      "posts/100.delivers.csv": delivers("100", "01", ["reader.a@example.com", "reader.b@example.com", "lurker@example.com"]),
      "posts/100.opens.csv": opens("100", "01", ["reader.a@example.com", "READER.A@example.com", "reader.b@example.com"]),
      "posts/200.delivers.csv": delivers("200", "08", ["reader.a@example.com", "reader.b@example.com", "lurker@example.com", "former@example.com"]),
      "posts/200.opens.csv": opens("200", "08", ["reader.a@example.com"]),
    })
    const files = new Map([...readZipEntries(archive, isNewsletterSignalsFile)].map(([name, data]) => [name, data.toString()]))
    const { posts: postSignals, subscribers } = computeNewsletterSignals(files)

    expect(postSignals).toEqual([
      { postId: "100", title: "First, with \"quotes\"", slug: "first-post", audience: "everyone", sentAt: "2026-01-01T10:00:00.000Z", delivered: 3, opened: 2 },
      { postId: "200", title: "Second", slug: "second-post", audience: "everyone", sentAt: "2026-01-08T10:00:00.000Z", delivered: 4, opened: 1 },
    ])
    const byEmail = Object.fromEntries(subscribers.map((subscriber) => [subscriber.email, subscriber]))
    expect(byEmail["reader.a@example.com"]).toMatchObject({ inEmailList: true, activeSubscription: true, plan: "paid", delivered: 2, opened: 2, sendsSinceOpen: 0, lastOpenedAt: "2026-01-08T12:00:00.000Z" })
    expect(byEmail["reader.b@example.com"]).toMatchObject({ delivered: 2, opened: 1, sendsSinceOpen: 1, lastDeliveredAt: "2026-01-08T10:00:00.000Z" })
    expect(byEmail["lurker@example.com"]).toMatchObject({ delivered: 2, opened: 0, sendsSinceOpen: 2, lastOpenedAt: null, subscribedAt: null })
    expect(byEmail["former@example.com"]).toMatchObject({ inEmailList: false, plan: null, delivered: 1 })
    // Location and device columns are never carried into the result.
    expect(JSON.stringify(subscribers)).not.toContain("Town")
  })
})
