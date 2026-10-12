import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Redacted, Stream } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { RpcTest } from "effect/rpc"
import { layer, layerWebhook, ResultCode, ShamCash } from "../src/effect/index.ts"
import { ShamCashPaymentError, ShamCashRpcs } from "../src/effect/rpc/index.ts"
import { layerHandlers } from "../src/effect/rpc/server.ts"
import { AGENT_KEY, BASE_URL, bill, fail, mockServer, ok, SECRET, webhookBody } from "./helpers.ts"

const live = (server: ReturnType<typeof mockServer>) =>
  layer({ agentKey: AGENT_KEY, secretKey: Redacted.make(SECRET), baseUrl: BASE_URL }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, server.fetch as typeof fetch)),
  )

const run = <A, E>(server: ReturnType<typeof mockServer>, effect: Effect.Effect<A, E, ShamCash>) =>
  Effect.runPromiseExit(Effect.provide(effect, live(server)))

const use = <A, E>(f: (sc: ShamCash["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* f(yield* ShamCash)
  })

const input = {
  billNo: "BN-123",
  amount: 10.5,
  currency: "USD" as const,
  callbackUrl: "https://agent.test/webhook",
  redirectUrl: "https://agent.test/checkout",
}

describe("ShamCash service", () => {
  test("createBill decodes the bill", async () => {
    const server = mockServer(() => ok(bill()))
    const exit = await run(
      server,
      use((sc) => sc.createBill(input)),
    )
    expect(exit).toEqual(Exit.succeed(bill()) as never)
    expect(server.received[0]?.payload.currencyId).toBe(1)
  })

  test("api errors are tagged", async () => {
    const server = mockServer(() => fail(ResultCode.BillNotFound, "Bill Not Found"))
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          use((sc) => sc.getBill("nope")),
          live(server),
        ),
      ),
    )
    expect(error).toMatchObject({ _tag: "ShamCashApiError", code: 1703 })
  })

  test("unexpected shapes are decode errors", async () => {
    const server = mockServer(() => ok({ billNo: 1 }))
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          use((sc) => sc.getBill("x")),
          live(server),
        ),
      ),
    )
    expect(error._tag).toBe("ShamCashDecodeError")
  })

  test("validation errors are tagged and nothing is sent", async () => {
    const server = mockServer(() => ok(bill()))
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          use((sc) => sc.createBill({ ...input, amount: 1.234 })),
          live(server),
        ),
      ),
    )
    expect(error._tag).toBe("ShamCashValidationError")
    expect(server.received).toHaveLength(0)
  })

  test("transactions streams across pages", async () => {
    const tx = (tranId: number) => ({
      billNo: "B",
      amount: 1,
      currencyId: 2,
      createdDate: "2026-05-19",
      createdTime: "07:29",
      tranId,
      tranTypeId: 2,
      tranType: "refund",
    })
    const server = mockServer((req) =>
      req.payload.afterTranId === 0
        ? ok({ list: [tx(1), tx(2)], hasMore: true, lastReturnedTranId: 2 })
        : ok({ list: [tx(3)], hasMore: false, lastReturnedTranId: 3 }),
    )
    const exit = await run(
      server,
      use((sc) => Stream.runCollect(sc.transactions({ limit: 10 }))),
    )
    expect(Exit.isSuccess(exit) && exit.value.map((t) => t.tranId)).toEqual([1, 2, 3])
  })

  test("parseWebhook", async () => {
    const server = mockServer(() => ok(null))
    const body = await webhookBody({ billNo: "BN-1", tranId: 7, statusId: 4 })
    const exit = await run(
      server,
      use((sc) => sc.parseWebhook(body)),
    )
    expect(Exit.isSuccess(exit) && exit.value).toMatchObject({ billNo: "BN-1", tranId: 7 })
  })
})

describe("layerWebhook", () => {
  const handlerFor = (onEvent: (e: { billNo: string }) => Effect.Effect<void, string>) =>
    HttpRouter.toWebHandler(
      layerWebhook({ path: "/webhooks/shamcash", onEvent }).pipe(
        Layer.provide(live(mockServer(() => ok(null)))),
      ),
      { disableLogger: true },
    )

  const post = (body: string) =>
    new Request("http://localhost/webhooks/shamcash", { method: "POST", body })

  test("200 on a verified event", async () => {
    const seen: string[] = []
    const { handler, dispose } = handlerFor((e) => Effect.sync(() => void seen.push(e.billNo)))
    const res = await handler(post(await webhookBody({ billNo: "BN-9", tranId: 1, statusId: 4 })))
    expect(res.status).toBe(200)
    expect(seen).toEqual(["BN-9"])
    await dispose()
  })

  test("400 on tampered body, 500 when the handler fails", async () => {
    const { handler, dispose } = handlerFor(() => Effect.fail("db down"))
    expect((await handler(post('{"encData":"x.y.z"}'))).status).toBe(400)
    const res = await handler(post(await webhookBody({ billNo: "BN-9", tranId: 1, statusId: 4 })))
    expect(res.status).toBe(500)
    await dispose()
  })
})

describe("rpc", () => {
  const client = (server: ReturnType<typeof mockServer>) =>
    RpcTest.makeClient(ShamCashRpcs).pipe(
      Effect.provide(
        layerHandlers({
          callbackUrl: "https://agent.test/webhook",
          redirectUrl: "https://agent.test/checkout",
          resolve: (ref) =>
            ref === "order-1"
              ? Effect.succeed({ billNo: "order-1-1", amount: "25.00", currency: "SYP" as const })
              : Effect.fail(new ShamCashPaymentError({ reason: "NotFound", message: "No order" })),
        }).pipe(Layer.provide(live(server))),
      ),
    )

  test("StartPayment creates the bill server-side", async () => {
    const server = mockServer(() => ok(bill({ billNo: "order-1-1" })))
    const session = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(client(server), (c) => c["ShamCash.StartPayment"]({ ref: "order-1" })),
      ),
    )
    expect(session).toEqual({ billNo: "order-1-1", paymentUrl: bill().paymentUrl })
    expect(server.received[0]?.payload).toMatchObject({ amount: 25, currencyId: 2 })
  })

  test("StartPayment resumes after 1704", async () => {
    const server = mockServer((req) =>
      req.endpoint === "createBill" ? fail(1704, "Bill No Already Exists") : ok(bill()),
    )
    const session = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(client(server), (c) => c["ShamCash.StartPayment"]({ ref: "order-1" })),
      ),
    )
    expect(session.paymentUrl).toBe(bill().paymentUrl)
    expect(server.received.map((r) => r.endpoint)).toEqual(["createBill", "getBillInfo"])
  })

  test("errors are sanitized", async () => {
    const server = mockServer(() => ({ status: 502, body: "upstream secrets" }))
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.flip(
          Effect.flatMap(client(server), (c) => c["ShamCash.StartPayment"]({ ref: "order-1" })),
        ),
      ),
    )
    expect(error).toMatchObject({ _tag: "ShamCashPaymentError", reason: "Unavailable" })
  })

  test("GetPaymentStatus", async () => {
    const server = mockServer(() => ok(bill({ statusId: 4, statusName: "paid" })))
    const status = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(client(server), (c) => c["ShamCash.GetPaymentStatus"]({ billNo: "BN-123" })),
      ),
    )
    expect(status).toEqual({ billNo: "BN-123", statusId: 4, statusName: "paid" })
  })
})
