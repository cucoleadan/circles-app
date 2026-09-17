import type { ConnectionEnvelope } from "./types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function publicKeyDer(publicKeyPem: string): ArrayBuffer {
  const base64 = publicKeyPem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "");

  return toArrayBuffer(base64ToBytes(base64));
}

export async function encryptConnectionCredential({
  publicKeyPem,
  keyId,
  credential,
}: {
  publicKeyPem: string;
  keyId: string;
  credential: string;
}): Promise<ConnectionEnvelope> {
  if (!credential.trim()) {
    throw new Error("A Substack session credential is required.");
  }

  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyDer(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    new TextEncoder().encode(credential),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    await crypto.subtle.exportKey("raw", aesKey),
  );

  return {
    version: 1,
    keyId,
    wrappedKey: base64UrlEncode(wrappedKey),
    iv: base64UrlEncode(toArrayBuffer(iv)),
    ciphertext: base64UrlEncode(ciphertext),
  };
}
