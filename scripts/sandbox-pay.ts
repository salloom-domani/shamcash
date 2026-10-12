/**
 * Interactive sandbox walkthrough: create → pay (code 000000) → webhook →
 * refund (partial, idempotent replay, rest) → ledger.
 *
 *   bun run sandbox:pay
 *
 * For webhooks, set SHAMCASH_PUBLIC_URL to a tunnel to http://localhost:3000.
 */
import {
  BillStatus,
  createBill,
  getBill,
  isShamCashError,
  refund,
  type ShamCashConfig,
  transactions,
} from "../src/index.ts"
import { createWebhookHandler } from "../src/webhook/index.ts"

const env = process.env
const config: ShamCashConfig = {
  agentKey: env.SHAMCASH_AGENT_KEY ?? "",
  secretKey: env.SHAMCASH_SECRET_KEY ?? "",
  baseUrl: env.SHAMCASH_BASE_URL ?? "",
}
const publicUrl = env.SHAMCASH_PUBLIC_URL || "https://example.com"
const port = 3000

const webhook = createWebhookHandler(config, {
  onEvent: (event) => console.log("\n📬 webhook:", event),
  onError: (error) => console.log("\n⚠️  webhook rejected:", error),
})
const server = env.SHAMCASH_PUBLIC_URL
  ? Bun.serve({ port, routes: { "/webhooks/shamcash": webhook } })
  : undefined
console.log(
  server
    ? `Webhook server on :${port}, expecting ${publicUrl}/webhooks/shamcash`
    : "No SHAMCASH_PUBLIC_URL: webhooks won't reach you (the payment flow still works).",
)

try {
  const billNo = `sdk-pay-${Date.now()}`
  const bill = await createBill(config, {
    billNo,
    amount: "1.00",
    currency: "USD",
    callbackUrl: `${publicUrl}/webhooks/shamcash`,
    redirectUrl: `${publicUrl}/checkout/return`,
    note: "shamcash sdk sandbox payment",
  })
  console.log(`\nBill ${billNo} created (expires in 10 min).`)
  console.log(`Open and pay with confirmation code 000000:\n\n  ${bill.paymentUrl}\n`)

  prompt("Press Enter once paid…")
  const paid = await getBill(config, billNo)
  console.log("Status:", paid.statusId, paid.statusName, "tranId:", paid.tranId)

  if (paid.statusId === BillStatus.Paid && prompt("Test refunds? [y/N]")?.toLowerCase() === "y") {
    const first = await refund(config, { billNo, amount: "0.40", note: "partial" })
    console.log("Partial refund:", first)
    const replay = await refund(config, {
      billNo,
      amount: "0.40",
      idempotencyKey: first.idempotencyKey,
    })
    console.log(
      `Replay with same key → tranId ${replay.tranId} (same: ${replay.tranId === first.tranId})`,
    )
    console.log("After partial:", (await getBill(config, billNo)).statusName)
    const rest = await refund(config, { billNo, amount: "0.60", note: "rest" })
    console.log("Remaining refund:", rest)
    const final = await getBill(config, billNo)
    console.log("Final:", final.statusId, final.statusName, final.refunds)
  }

  const today = new Date().toISOString().slice(0, 10)
  console.log(`\nToday's ledger entries for ${billNo}:`)
  for await (const tx of transactions(config, { fromDate: today, toDate: today, limit: 100 })) {
    if (tx.billNo === billNo) console.log(" ", tx)
  }

  if (server) prompt("\nPress Enter to stop the webhook server…")
} catch (error) {
  console.error(isShamCashError(error) ? { ...error, message: error.message } : error)
  process.exitCode = 1
} finally {
  server?.stop()
}
