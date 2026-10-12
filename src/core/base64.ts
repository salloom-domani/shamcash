const toBinary = (bytes: Uint8Array): string => {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

const fromBinary = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Standard base64 (with padding) → bytes. Throws on invalid input. */
export const base64Decode = (input: string): Uint8Array => fromBinary(atob(input.trim()))

/** Bytes → base64url, no padding. */
export const base64UrlEncode = (bytes: Uint8Array): string =>
  btoa(toBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/** base64url (padding optional) → bytes. Throws on invalid input. */
export const base64UrlDecode = (input: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new TypeError("Invalid base64url")
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/")
  return fromBinary(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))
}
