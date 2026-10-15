// Runs the built package on any runtime: node, bun, deno.
import assert from "node:assert/strict"
import { createBill, createShamCash, decrypt, encrypt, importSecretKey } from "@siters/shamcash"
import { isPaid, openPayment } from "@siters/shamcash/client"
import { ShamCash } from "@siters/shamcash/effect"
import { ShamCashRpcs } from "@siters/shamcash/effect/rpc"
import { createWebhookHandler } from "@siters/shamcash/webhook"

const secretKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
const key = await importSecretKey(secretKey)
assert.deepEqual(await decrypt(key, await encrypt(key, { a: 1 })), { a: 1 })

const fetch = async (_url, init) => {
  const { encData } = JSON.parse(init.body)
  const { billNo } = await decrypt(key, encData)
  return Response.json({ result: 2500, succeeded: true, message: "Success", data: { billNo } })
}
const config = { agentKey: "a", secretKey, baseUrl: "https://x.test", fetch }
assert.equal(
  (
    await createBill(config, {
      billNo: "B-1",
      amount: "1.00",
      currency: "USD",
      callbackUrl: "https://x.test/cb",
      redirectUrl: "https://x.test/r",
    })
  ).billNo,
  "B-1",
)

const iat = Math.floor(Date.now() / 1000)
const handler = createWebhookHandler(config, { onEvent: () => {} })
const res = await handler(
  new Request("https://x.test/cb", {
    method: "POST",
    body: JSON.stringify({
      encData: await encrypt(key, { billNo: "B-1", tranId: 1, statusId: 4, iat, exp: iat + 300 }),
    }),
  }),
)
assert.equal(res.status, 200)

assert.equal(typeof createShamCash, "function")
assert.equal(isPaid(4), true)
assert.equal(typeof openPayment, "function")
assert.ok(ShamCash && ShamCashRpcs)
console.log(
  `smoke ok (${typeof Bun !== "undefined" ? "bun" : typeof Deno !== "undefined" ? "deno" : "node"})`,
)
