import { afterEach, describe, expect, test } from "bun:test"
import { openSessionToken, resealSessionToken, sealSessionToken, SESSION_TOKEN_KEY_ID } from "../src/session-token.js"

const originalKey = process.env.SESSION_TOKEN_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.SESSION_TOKEN_KEY
  else process.env.SESSION_TOKEN_KEY = originalKey
})

describe("Substack session token storage", () => {
  test("stores tokens as before when no key is configured", () => {
    delete process.env.SESSION_TOKEN_KEY
    const sealed = sealSessionToken("s%3Atoken")
    expect(sealed).toEqual({ keyId: "plain", wrappedKey: "plain", iv: "plain", ciphertext: "s%3Atoken" })
    expect(openSessionToken({ key_id: sealed.keyId, iv: sealed.iv, ciphertext: sealed.ciphertext })).toBe("s%3Atoken")
  })

  test("encrypts with SESSION_TOKEN_KEY and still reads legacy plain rows", () => {
    process.env.SESSION_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64")
    const sealed = sealSessionToken("s%3Atoken")
    expect(sealed.keyId).toBe(SESSION_TOKEN_KEY_ID)
    expect(sealed.ciphertext).not.toContain("token")
    expect(openSessionToken({ key_id: sealed.keyId, iv: sealed.iv, ciphertext: sealed.ciphertext })).toBe("s%3Atoken")
    expect(openSessionToken({ key_id: "plain", iv: "plain", ciphertext: "legacy" })).toBe("legacy")
  })

  test("refuses to read encrypted rows without the key", () => {
    process.env.SESSION_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64")
    const sealed = sealSessionToken("s%3Atoken")
    delete process.env.SESSION_TOKEN_KEY
    expect(() => openSessionToken({ key_id: sealed.keyId, iv: sealed.iv, ciphertext: sealed.ciphertext })).toThrow(
      "SESSION_TOKEN_KEY is required",
    )
  })

  test("reseals legacy plain rows only once a key is configured", () => {
    delete process.env.SESSION_TOKEN_KEY
    expect(resealSessionToken({ key_id: "plain", iv: "plain", ciphertext: "legacy" })).toBeNull()
    process.env.SESSION_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64")
    const resealed = resealSessionToken({ key_id: "plain", iv: "plain", ciphertext: "legacy" })!
    expect(openSessionToken({ key_id: resealed.keyId, iv: resealed.iv, ciphertext: resealed.ciphertext })).toBe("legacy")
    expect(resealSessionToken({ key_id: resealed.keyId, iv: resealed.iv, ciphertext: resealed.ciphertext })).toBeNull()
  })
})
