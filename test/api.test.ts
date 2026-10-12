import { describe, expect, test } from "bun:test"
import {
  createBill,
  createShamCash,
  getBill,
  getTransactions,
  parseWebhook,
  ResultCode,
  refund,
  transactions,
} from "../src/index.ts"
import { AGENT_KEY, bill, config, fail, mockServer, ok, webhookBody } from "./helpers.ts"

const input = {
  billNo: "BN-123",
  amount: "10.50",
  currency: "USD" as const,
  callbackUrl: "https://agent.test/webhook",
  redirectUrl: "https://agent.test/checkout",
  note: "Example",
}

describe("createBill", () => {
  test("sends an encrypted payload with claims and returns the bill", async () => {
    const server = mockServer(() => ok(bill()))
    const result = await createBill(config(server.fetch), input)
    expect(result.paymentUrl).toBe("https://pay.shamcash.test/b/abc")

    const [req] = server.received
    expect(req?.endpoint).toBe("createBill")
    expect(req?.agentKey).toBe(AGENT_KEY)
    const { iat, exp, ...rest } = req!.payload as { iat: number; exp: number }
    expect(exp - iat).toBe(300)
    expect(rest).toEqual({
      billNo: "BN-123",
      amount: 10.5,
      currencyId: 1,
      callbackUrl: input.callbackUrl,
      redirectUrl: input.redirectUrl,
      note: "Example",
    })
  })

  test("maps result codes to ShamCashError", async () => {
    const server = mockServer(() => fail(ResultCode.BillNoAlreadyExists, "Bill No Already Exists"))
    await expect(createBill(config(server.fetch), input)).rejects.toMatchObject({
      kind: "api",
      code: 1704,
      message: "Bill No Already Exists",
    })
  })

  test("non-200 is an http error", async () => {
    const server = mockServer(() => ({
      status: 502,
      body: "<html>Bad Gateway</html>",
    }))
    await expect(createBill(config(server.fetch), input)).rejects.toMatchObject({
      kind: "http",
      status: 502,
    })
  })

  test("network failure", async () => {
    const cfg = {
      ...config(mockServer(() => ok(null)).fetch),
      fetch: () => Promise.reject(new Error("ECONNRESET")),
    }
    await expect(createBill(cfg, input)).rejects.toMatchObject({
      kind: "network",
    })
  })

  test.each([
    [{ amount: "10.505" }, "amount"],
    [{ amount: 0 }, "amount"],
    [{ amount: -1 }, "amount"],
    [{ billNo: " " }, "billNo"],
    [{ callbackUrl: "ftp://x.test" }, "callbackUrl"],
    [{ redirectUrl: `https://x.test/${"a".repeat(500)}` }, "redirectUrl"],
    [{ currency: "EUR" }, "currency"],
  ])("validates %p locally", async (patch, field) => {
    const server = mockServer(() => ok(bill()))
    await expect(
      createBill(config(server.fetch), { ...input, ...patch } as typeof input),
    ).rejects.toMatchObject({
      kind: "validation",
      message: expect.stringContaining(field),
    })
    expect(server.received).toHaveLength(0)
  })
})

test("getBill", async () => {
  const server = mockServer(() => ok(bill({ statusId: 4, statusName: "paid", tranId: 3827551 })))
  const result = await getBill(config(server.fetch), "BN-123")
  expect(result.tranId).toBe(3827551)
  expect(server.received[0]?.payload.billNo).toBe("BN-123")
})

describe("refund", () => {
  test("generates and returns an idempotency key", async () => {
    const server = mockServer(() => ok({ tranId: 3919468 }))
    const result = await refund(config(server.fetch), {
      billNo: "BN-123",
      amount: 1,
    })
    expect(result.tranId).toBe(3919468)
    expect(result.idempotencyKey).toHaveLength(36)
    expect(server.received[0]?.payload.idempotencyKey).toBe(result.idempotencyKey)
  })

  test("reuses a given key", async () => {
    const server = mockServer(() => ok({ tranId: 1 }))
    const idempotencyKey = "order-1-refund-1"
    const result = await refund(config(server.fetch), {
      billNo: "BN-1",
      amount: 1,
      idempotencyKey,
    })
    expect(result.idempotencyKey).toBe(idempotencyKey)
  })
})

describe("transactions", () => {
  const tx = (tranId: number) => ({
    billNo: `B-${tranId}`,
    amount: 1,
    currencyId: 1,
    createdDate: "2026-05-19",
    createdTime: "07:29",
    tranId,
    tranTypeId: 1,
    tranType: "payment",
  })

  test("getTransactions sends defaults", async () => {
    const server = mockServer(() => ok({ list: [], hasMore: false, lastReturnedTranId: 0 }))
    await getTransactions(config(server.fetch))
    expect(server.received[0]?.payload).toMatchObject({
      fromDate: null,
      toDate: null,
      afterTranId: 0,
      limit: 500,
    })
  })

  test("iterates across pages with the cursor", async () => {
    const pages: Record<number, unknown> = {
      0: { list: [tx(1), tx(2)], hasMore: true, lastReturnedTranId: 2 },
      2: { list: [tx(3)], hasMore: false, lastReturnedTranId: 3 },
    }
    const server = mockServer((req) => ok(pages[req.payload.afterTranId as number]))
    const ids: number[] = []
    for await (const t of transactions(config(server.fetch), {
      fromDate: "2026-01-01",
      limit: 10,
    })) {
      ids.push(t.tranId)
    }
    expect(ids).toEqual([1, 2, 3])
    expect(server.received.map((r) => r.payload.afterTranId)).toEqual([0, 2])
    expect(server.received.every((r) => r.payload.fromDate === "2026-01-01")).toBe(true)
  })

  test("validates limit and dates", async () => {
    const server = mockServer(() => ok(null))
    const cfg = config(server.fetch)
    await expect(getTransactions(cfg, { limit: 5 })).rejects.toMatchObject({
      kind: "validation",
    })
    await expect(getTransactions(cfg, { fromDate: "01/01/2026" })).rejects.toMatchObject({
      kind: "validation",
    })
  })
})

describe("parseWebhook", () => {
  const cfg = config(mockServer(() => ok(null)).fetch)

  test("paid", async () => {
    const event = await parseWebhook(
      cfg,
      await webhookBody({ billNo: "BN-1", tranId: 9, statusId: 4 }),
    )
    expect(event).toMatchObject({ billNo: "BN-1", tranId: 9, statusId: 4 })
  })

  test("expired, from parsed JSON", async () => {
    const body = JSON.parse(await webhookBody({ billNo: "BN-1", tranId: null, statusId: 3 }))
    expect(await parseWebhook(cfg, body)).toMatchObject({
      tranId: null,
      statusId: 3,
    })
  })

  test("rejects replays past exp", async () => {
    const body = await webhookBody(
      { billNo: "BN-1", tranId: 9, statusId: 4 },
      Date.now() - 3_600_000,
    )
    await expect(parseWebhook(cfg, body)).rejects.toMatchObject({
      kind: "crypto",
    })
  })

  test("rejects garbage", async () => {
    await expect(parseWebhook(cfg, "nope")).rejects.toMatchObject({
      kind: "decode",
    })
    await expect(parseWebhook(cfg, { encData: "a.b.c" })).rejects.toMatchObject({ kind: "crypto" })
  })
})

test("createShamCash binds config", async () => {
  const server = mockServer(() => ok(bill()))
  const sc = createShamCash(config(server.fetch))
  expect((await sc.getBill("BN-123")).billNo).toBe("BN-123")
})

test("refuses to run in a browser", async () => {
  const g = globalThis as Record<string, unknown>
  g.window = {}
  g.document = {}
  try {
    await expect(getBill(config(mockServer(() => ok(null)).fetch), "x")).rejects.toMatchObject({
      message: expect.stringContaining("browser"),
    })
  } finally {
    delete g.window
    delete g.document
  }
})
