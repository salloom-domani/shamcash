import { describe, expect, test } from "bun:test"
import { assertPaymentUrl, isFinal, isPaid, openPayment } from "../src/client/index.ts"
import type { WebhookEvent } from "../src/index.ts"
import { createWebhookHandler } from "../src/webhook/index.ts"
import { config, mockServer, ok, webhookBody } from "./helpers.ts"

const cfg = config(mockServer(() => ok(null)).fetch)
const post = (body: string) => new Request("http://localhost/wh", { method: "POST", body })

describe("createWebhookHandler", () => {
  test("200 and delivers the event", async () => {
    const events: WebhookEvent[] = []
    const handler = createWebhookHandler(cfg, {
      onEvent: (e) => void events.push(e),
    })
    const res = await handler(post(await webhookBody({ billNo: "BN-1", tranId: 5, statusId: 4 })))
    expect(res.status).toBe(200)
    expect(events[0]).toMatchObject({ billNo: "BN-1", tranId: 5, statusId: 4 })
  })

  test("400 on invalid, 405 on GET, 500 when onEvent throws", async () => {
    const errors: unknown[] = []
    const handler = createWebhookHandler(cfg, {
      onEvent: () => {
        throw new Error("db down")
      },
      onError: (e) => void errors.push(e),
    })
    expect((await handler(post("{}"))).status).toBe(400)
    expect((await handler(new Request("http://localhost/wh"))).status).toBe(405)
    const res = await handler(
      post(await webhookBody({ billNo: "BN-1", tranId: null, statusId: 3 })),
    )
    expect(res.status).toBe(500)
    expect(errors).toHaveLength(2)
  })
})

describe("client", () => {
  test("status helpers", () => {
    expect(isPaid(4)).toBe(true)
    expect(isPaid(5)).toBe(false)
    expect(isFinal(1)).toBe(false)
    expect(isFinal(3)).toBe(true)
  })

  test("openPayment rejects non-http urls and uses a custom opener", () => {
    expect(() => assertPaymentUrl("javascript:alert(1)")).toThrow()
    const opened: string[] = []
    openPayment("https://pay.shamcash.test/b/1", {
      open: (u) => opened.push(u),
    })
    expect(opened).toEqual(["https://pay.shamcash.test/b/1"])
  })
})
