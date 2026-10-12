/**
 * Live sandbox checks. Skipped unless run via `bun run test:sandbox` with a
 * filled-in .env. Verifies our assumptions about the real API — especially
 * that responses match the Effect schemas.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { layer, ShamCash } from "../../src/effect/index.ts"
import { createBill, getBill, getTransactions, ResultCode, refund } from "../../src/index.ts"

const env = process.env
const enabled = env.SHAMCASH_E2E === "1"
const missing = ["SHAMCASH_AGENT_KEY", "SHAMCASH_SECRET_KEY", "SHAMCASH_BASE_URL"].filter(
  (name) => !env[name],
)
if (enabled && missing.length > 0) {
  throw new Error(`Sandbox tests need ${missing.join(", ")} — copy .env.example to .env`)
}

const config = {
  agentKey: env.SHAMCASH_AGENT_KEY ?? "",
  secretKey: env.SHAMCASH_SECRET_KEY ?? "",
  baseUrl: env.SHAMCASH_BASE_URL ?? "",
}
const publicUrl = env.SHAMCASH_PUBLIC_URL || "https://example.com"
const billInput = (billNo: string) => ({
  billNo,
  amount: "1.00",
  currency: "USD" as const,
  callbackUrl: `${publicUrl}/webhooks/shamcash`,
  redirectUrl: `${publicUrl}/checkout/return`,
  note: "shamcash sdk sandbox test",
})

const effect = <A, E>(f: (sc: ShamCash["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* ShamCash)
    }).pipe(
      Effect.provide(
        layer({ ...config, secretKey: Redacted.make(config.secretKey) }).pipe(
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
    ),
  )

describe.skipIf(!enabled)("sandbox", () => {
  const billNo = `sdk-test-${Date.now()}`

  test("createBill returns a pending bill", async () => {
    const bill = await createBill(config, billInput(billNo))
    console.log("paymentUrl:", bill.paymentUrl)
    expect(bill).toMatchObject({ billNo, statusId: 1, amount: 1, currencyId: 1, tranId: null })
    expect(bill.refunds).toEqual([])
    expect(new URL(bill.paymentUrl).protocol).toBe("https:")
  })

  test("getBill matches, and decodes with the Effect schema", async () => {
    const plain = await getBill(config, billNo)
    const decoded = await effect((sc) => sc.getBill(billNo))
    expect(decoded).toEqual(plain)
  })

  test("duplicate billNo → 1704", async () => {
    await expect(createBill(config, billInput(billNo))).rejects.toMatchObject({
      kind: "api",
      code: ResultCode.BillNoAlreadyExists,
    })
  })

  test("unknown billNo → 1703", async () => {
    await expect(getBill(config, `missing-${Date.now()}`)).rejects.toMatchObject({
      code: ResultCode.BillNotFound,
    })
  })

  test("refund on an unpaid bill → 1707", async () => {
    await expect(refund(config, { billNo, amount: "1.00" })).rejects.toMatchObject({
      code: ResultCode.OriginBillNotPaid,
    })
  })

  test("getTransactions decodes with the Effect schema", async () => {
    const plain = await getTransactions(config, { limit: 10 })
    const decoded = await effect((sc) => sc.getTransactions({ limit: 10 }))
    expect(decoded).toEqual(plain)
    console.log(`transactions: ${plain.list.length} (hasMore: ${plain.hasMore})`)
  })

  test("getTransactions with a date range", async () => {
    const today = new Date().toISOString().slice(0, 10)
    const page = await getTransactions(config, { fromDate: "2026-01-01", toDate: today, limit: 10 })
    expect(Array.isArray(page.list)).toBe(true)
  })

  test("wrong agentKey → 1701", async () => {
    await expect(
      getBill({ ...config, agentKey: "not-a-real-agent" }, billNo),
    ).rejects.toMatchObject({
      code: ResultCode.AgentKeyInvalid,
    })
  })

  test("wrong secretKey → 1705", async () => {
    const wrong = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    await expect(getBill({ ...config, secretKey: wrong }, billNo)).rejects.toMatchObject({
      code: ResultCode.EncryptedDataInvalid,
    })
  })
})
