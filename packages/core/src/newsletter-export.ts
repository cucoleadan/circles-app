import { inflateRawSync } from "node:zlib"

/** A subscriber is "going cold" after this many sends without an open. */
export const NEWSLETTER_COLD_AFTER_SENDS = 5

/**
 * Reads the entries of a zip archive whose names pass `wanted`, using the
 * central directory. Only stored and deflated entries are supported, which is
 * what Substack's publication export uses.
 */
// ponytail: whole archive in memory and no zip64; stream entries if exports grow past a few hundred MB.
export function readZipEntries(zip: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error("Export is not a zip archive")
  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  if (count === 0xffff || offset === 0xffffffff) throw new Error("Zip64 exports are not supported")

  const entries = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Corrupt zip central directory")
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (!wanted(name)) continue
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const data = zip.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) entries.set(name, data)
    else if (method === 8) entries.set(name, inflateRawSync(data))
    else throw new Error(`Unsupported zip compression method ${method}`)
  }
  return entries
}

/** RFC 4180 CSV into header-keyed rows. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === "\"" && input[i + 1] === "\"") { field += "\""; i++ }
      else if (char === "\"") quoted = false
      else field += char
    } else if (char === "\"") quoted = true
    else if (char === ",") { row.push(field); field = "" }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++
      row.push(field); rows.push(row); row = []; field = ""
    } else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows
  if (!header) return []
  return body
    .filter((cells) => cells.some(Boolean))
    .map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""])))
}

export interface NewsletterPostSignal {
  postId: string
  title: string | null
  slug: string | null
  audience: string | null
  sentAt: string | null
  delivered: number
  opened: number
}

export interface NewsletterSubscriberSignal {
  email: string
  inEmailList: boolean
  activeSubscription: boolean | null
  plan: string | null
  subscribedAt: string | null
  delivered: number
  opened: number
  lastOpenedAt: string | null
  lastDeliveredAt: string | null
  sendsSinceOpen: number
}

const isoOrNull = (value: string | undefined) =>
  value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null
const boolOrNull = (value: string | undefined) => value === "true" ? true : value === "false" ? false : null
const normalizeEmail = (value: string | undefined) => (value ?? "").trim().toLowerCase()

/**
 * Computes post and subscriber engagement from the export's CSV files.
 * Opens repeat per reader, so a post counts once per subscriber. Only email,
 * plan and delivery/open timing are read; location and device columns are not.
 */
export function computeNewsletterSignals(files: Map<string, string>): {
  posts: NewsletterPostSignal[]
  subscribers: NewsletterSubscriberSignal[]
} {
  const postMeta = new Map<string, Record<string, string>>()
  for (const [name, text] of files) {
    if (name === "posts.csv") {
      for (const row of parseCsv(text)) {
        const [id] = (row.post_id ?? "").split(".")
        if (id && /^\d+$/.test(id)) postMeta.set(id, row)
      }
    }
  }

  type Reader = { delivered: number; opened: number; lastOpen: number; lastDelivered: number; sinceOpen: number }
  const readers = new Map<string, Reader>()
  const reader = (email: string) => {
    let entry = readers.get(email)
    if (!entry) readers.set(email, entry = { delivered: 0, opened: 0, lastOpen: 0, lastDelivered: 0, sinceOpen: 0 })
    return entry
  }
  const postFiles = (kind: "opens" | "delivers") => [...files]
    .flatMap(([name, text]) => {
      const match = name.match(new RegExp(`^posts/(\\d+)\\.${kind}\\.csv$`))
      return match ? [{ postId: match[1]!, rows: parseCsv(text) }] : []
    })

  // Pass 1: who opened which post, and each reader's last open.
  const openedPairs = new Set<string>()
  const postOpeners = new Map<string, Set<string>>()
  for (const { postId, rows } of postFiles("opens")) {
    const openers = postOpeners.get(postId) ?? new Set<string>()
    postOpeners.set(postId, openers)
    for (const row of rows) {
      const email = normalizeEmail(row.email)
      if (!email) continue
      openers.add(email)
      openedPairs.add(`${postId}|${email}`)
      const at = Date.parse(row.timestamp ?? "")
      if (Number.isFinite(at)) reader(email).lastOpen = Math.max(reader(email).lastOpen, at)
    }
  }

  // Pass 2: deliveries, with opens counted only for posts the reader received.
  const posts: NewsletterPostSignal[] = []
  for (const { postId, rows } of postFiles("delivers")) {
    const recipients = new Set<string>()
    for (const row of rows) {
      const email = normalizeEmail(row.email)
      if (!email || recipients.has(email)) continue
      recipients.add(email)
      const entry = reader(email)
      const at = Date.parse(row.timestamp ?? "")
      entry.delivered++
      if (openedPairs.has(`${postId}|${email}`)) entry.opened++
      if (Number.isFinite(at)) {
        entry.lastDelivered = Math.max(entry.lastDelivered, at)
        if (at > entry.lastOpen) entry.sinceOpen++
      }
    }
    const meta = postMeta.get(postId)
    const slug = meta?.post_id?.split(".").slice(1).join(".") || null
    posts.push({
      postId,
      title: meta?.title || null,
      slug,
      audience: meta?.audience || null,
      sentAt: isoOrNull(meta?.email_sent_at) ?? isoOrNull(meta?.post_date),
      delivered: recipients.size,
      opened: [...(postOpeners.get(postId) ?? [])].filter((email) => recipients.has(email)).length,
    })
  }

  const listed = new Map<string, Record<string, string>>()
  for (const [name, text] of files) {
    if (/^email_list\..+\.csv$/.test(name)) {
      for (const row of parseCsv(text)) {
        const email = normalizeEmail(row.email)
        if (email) listed.set(email, row)
      }
    }
  }
  for (const email of listed.keys()) reader(email)

  const subscribers = [...readers].map(([email, entry]): NewsletterSubscriberSignal => {
    const row = listed.get(email)
    return {
      email,
      inEmailList: Boolean(row),
      activeSubscription: boolOrNull(row?.active_subscription),
      plan: row?.plan || null,
      subscribedAt: isoOrNull(row?.created_at),
      delivered: entry.delivered,
      opened: entry.opened,
      lastOpenedAt: entry.lastOpen ? new Date(entry.lastOpen).toISOString() : null,
      lastDeliveredAt: entry.lastDelivered ? new Date(entry.lastDelivered).toISOString() : null,
      sendsSinceOpen: entry.sinceOpen,
    }
  })
  return { posts, subscribers }
}

/** The export CSVs Circles reads; post HTML is skipped without inflating it. */
export function isNewsletterSignalsFile(name: string) {
  return name === "posts.csv" || /^email_list\..+\.csv$/.test(name) || /^posts\/\d+\.(opens|delivers)\.csv$/.test(name)
}
