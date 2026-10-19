import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/** Key id stored on connections sealed with SESSION_TOKEN_KEY (AES-256-GCM). */
export const SESSION_TOKEN_KEY_ID = "env-v1"
const PLAIN = "plain"

export interface SealedSessionToken {
  keyId: string
  wrappedKey: string
  iv: string
  ciphertext: string
}

export interface StoredSessionToken {
  key_id?: string | null
  iv?: string | null
  ciphertext: string
}

function configuredKey(): Buffer | null {
  const raw = process.env.SESSION_TOKEN_KEY?.trim()
  if (!raw) return null
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error("SESSION_TOKEN_KEY must be 32 bytes encoded as base64")
  return key
}

/**
 * Encrypts a Substack session token at rest when SESSION_TOKEN_KEY is set.
 * Without a key the token is stored as before ('plain'), so deployments that
 * have not configured the key keep working.
 */
export function sealSessionToken(token: string): SealedSessionToken {
  const key = configuredKey()
  if (!key) return { keyId: PLAIN, wrappedKey: PLAIN, iv: PLAIN, ciphertext: token }
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()])
  return {
    keyId: SESSION_TOKEN_KEY_ID,
    wrappedKey: "none",
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  }
}

/** Returns the usable session token for a stored connection row. */
export function openSessionToken(row: StoredSessionToken): string {
  if (!row.key_id || row.key_id === PLAIN) return row.ciphertext
  if (row.key_id !== SESSION_TOKEN_KEY_ID) throw new Error(`Unknown session token key id ${row.key_id}`)
  const key = configuredKey()
  if (!key) throw new Error("SESSION_TOKEN_KEY is required to read this Substack connection")
  if (!row.iv) throw new Error("Encrypted Substack connection is missing its IV")
  const data = Buffer.from(row.ciphertext, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"))
  decipher.setAuthTag(data.subarray(data.length - 16))
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8")
}

/** Sealed replacement for a legacy plain row once SESSION_TOKEN_KEY is set; null when nothing changes. */
export function resealSessionToken(row: StoredSessionToken): SealedSessionToken | null {
  if ((row.key_id && row.key_id !== PLAIN) || !configuredKey()) return null
  return sealSessionToken(row.ciphertext)
}
