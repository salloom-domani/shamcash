import { base64Decode, base64UrlDecode, base64UrlEncode } from "./base64.ts"
import { ShamCashError } from "./errors.ts"

/**
 * Direct JWE (`alg: dir`, `enc: A256GCM`) per spec §5, on WebCrypto only —
 * runs on Node, Bun, Deno, workers and edge runtimes.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const HEADER = base64UrlEncode(encoder.encode('{"alg":"dir","enc":"A256GCM","cty":"json"}'))
const IV_BYTES = 12
const TAG_BYTES = 16

const cryptoError = (message: string, cause?: unknown) =>
  new ShamCashError("crypto", message, { cause })

/** Import the base64 `secretKey` issued by ShamCash (32 raw bytes). */
export const importSecretKey = async (secretKey: string): Promise<CryptoKey> => {
  let raw: Uint8Array
  try {
    raw = base64Decode(secretKey)
  } catch (cause) {
    throw cryptoError("secretKey is not valid base64", cause)
  }
  if (raw.length !== 32) throw cryptoError(`secretKey must decode to 32 bytes, got ${raw.length}`)
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

/** Encrypt a JSON payload into a compact JWE: `header..iv.ciphertext.tag`. */
export const encrypt = async (key: CryptoKey, payload: unknown): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(HEADER),
        tagLength: TAG_BYTES * 8,
      },
      key,
      encoder.encode(JSON.stringify(payload)),
    ),
  )
  // WebCrypto returns ciphertext || tag
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES)
  const tag = sealed.subarray(sealed.length - TAG_BYTES)
  return `${HEADER}..${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}.${base64UrlEncode(tag)}`
}

/** Decrypt and authenticate a compact direct JWE; returns the parsed JSON payload. */
export const decrypt = async (key: CryptoKey, token: string): Promise<unknown> => {
  const parts = token.split(".")
  if (parts.length !== 5) throw cryptoError("JWE must have 5 parts")
  const [encodedHeader, encryptedKey, encodedIv, encodedCiphertext, encodedTag] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]
  if (encryptedKey !== "") throw cryptoError("JWE encrypted key must be empty for alg=dir")

  let header: unknown
  let iv: Uint8Array
  let ciphertext: Uint8Array
  let tag: Uint8Array
  try {
    header = JSON.parse(decoder.decode(base64UrlDecode(encodedHeader)))
    iv = base64UrlDecode(encodedIv)
    ciphertext = base64UrlDecode(encodedCiphertext)
    tag = base64UrlDecode(encodedTag)
  } catch (cause) {
    throw cryptoError("JWE is malformed", cause)
  }
  const h = header as { alg?: unknown; enc?: unknown } | null
  if (h?.alg !== "dir" || h.enc !== "A256GCM") throw cryptoError("Unsupported JWE header")
  if (iv.length !== IV_BYTES) throw cryptoError("JWE IV must be 12 bytes")
  if (tag.length !== TAG_BYTES) throw cryptoError("JWE tag must be 16 bytes")

  const sealed = new Uint8Array(ciphertext.length + TAG_BYTES)
  sealed.set(ciphertext)
  sealed.set(tag, ciphertext.length)

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as Uint8Array<ArrayBuffer>,
        // AAD is the header exactly as received, never re-serialized
        additionalData: encoder.encode(encodedHeader),
        tagLength: TAG_BYTES * 8,
      },
      key,
      sealed,
    )
  } catch (cause) {
    throw cryptoError("JWE authentication failed (wrong key or tampered token)", cause)
  }
  try {
    return JSON.parse(decoder.decode(plaintext))
  } catch (cause) {
    throw cryptoError("JWE payload is not JSON", cause)
  }
}

/** Add `iat` / `exp` (unix seconds) to a payload. */
export const withClaims = <A extends object>(
  payload: A,
  nowMs: number,
  ttlSeconds: number,
): A & { iat: number; exp: number } => {
  const iat = Math.floor(nowMs / 1000)
  return { ...payload, iat, exp: iat + ttlSeconds }
}

/** Reject expired or future-dated payloads, with `skewSeconds` tolerance. */
export const verifyClaims = (payload: unknown, nowMs: number, skewSeconds: number): void => {
  const p = payload as { iat?: unknown; exp?: unknown } | null
  if (typeof p !== "object" || p === null) throw cryptoError("JWE payload must be an object")
  if (typeof p.exp !== "number") throw cryptoError("JWE payload is missing exp")
  const now = Math.floor(nowMs / 1000)
  if (now > p.exp + skewSeconds) throw cryptoError("JWE payload has expired")
  if (typeof p.iat === "number" && p.iat > now + skewSeconds) {
    throw cryptoError("JWE payload is issued in the future")
  }
}
