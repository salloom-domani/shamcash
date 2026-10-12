import { describe, expect, test } from "bun:test"
import { CompactEncrypt, compactDecrypt } from "jose"
import { base64Decode } from "../src/core/base64.ts"
import { decrypt, encrypt, importSecretKey, verifyClaims, withClaims } from "../src/core/jwe.ts"
import { key, SECRET } from "./helpers.ts"

const raw = base64Decode(SECRET)
const payload = { billNo: "BN-123", amount: 10.5, note: "مرحبا ✓" }

describe("jwe", () => {
  test("token has 5 parts with an empty encrypted key", async () => {
    const parts = (await encrypt(key, payload)).split(".")
    expect(parts).toHaveLength(5)
    expect(parts[1]).toBe("")
    expect(JSON.parse(atob(parts[0]!))).toEqual({
      alg: "dir",
      enc: "A256GCM",
      cty: "json",
    })
  })

  test("jose decrypts our tokens", async () => {
    const { plaintext, protectedHeader } = await compactDecrypt(await encrypt(key, payload), raw)
    expect(protectedHeader).toEqual({
      alg: "dir",
      enc: "A256GCM",
      cty: "json",
    })
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(payload)
  })

  test("we decrypt jose tokens", async () => {
    const token = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", cty: "json" })
      .encrypt(raw)
    expect(await decrypt(key, token)).toEqual(payload)
  })

  test("rejects tampering", async () => {
    const parts = (await encrypt(key, payload)).split(".")
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1)
    for (const i of [0, 2, 3, 4]) {
      const copy = [...parts]
      copy[i] = flip(copy[i]!)
      await expect(decrypt(key, copy.join("."))).rejects.toMatchObject({
        kind: "crypto",
      })
    }
  })

  test("rejects the wrong key", async () => {
    const other = await importSecretKey(btoa(String.fromCharCode(...new Uint8Array(32))))
    await expect(decrypt(other, await encrypt(key, payload))).rejects.toMatchObject({
      kind: "crypto",
    })
  })

  test("rejects keys that are not 32 bytes", async () => {
    await expect(importSecretKey(btoa("short"))).rejects.toMatchObject({
      kind: "crypto",
    })
  })

  test("claims", () => {
    const now = 1_777_643_724_000
    const claimed = withClaims({ a: 1 }, now, 300)
    expect(claimed).toEqual({ a: 1, iat: 1_777_643_724, exp: 1_777_644_024 })
    expect(() => verifyClaims(claimed, now, 0)).not.toThrow()
    expect(() => verifyClaims(claimed, now + 301_000, 0)).toThrow("expired")
    expect(() => verifyClaims(claimed, now + 301_000, 60)).not.toThrow()
    expect(() => verifyClaims(claimed, now - 120_000, 60)).toThrow("future")
    expect(() => verifyClaims({ a: 1 }, now, 60)).toThrow("missing exp")
  })
})
