// bun examples/effect-server.ts — ShamCash RPC + webhook on one Effect HttpRouter.

import { layerConfig, layerWebhook } from "@siters/shamcash/effect"
import { ShamCashPaymentError, ShamCashRpcs } from "@siters/shamcash/effect/rpc"
import { layerHandlers } from "@siters/shamcash/effect/rpc/server"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"

// Stand-in for your order store.
const orders = new Map([["order-1", { total: "25.00", attempts: 0 }]])

// Reads SHAMCASH_AGENT_KEY / SHAMCASH_SECRET_KEY / SHAMCASH_BASE_URL
const ShamCashLive = layerConfig().pipe(Layer.provide(FetchHttpClient.layer))

const RpcLive = RpcServer.layerHttp({ group: ShamCashRpcs, path: "/rpc", protocol: "http" }).pipe(
  Layer.provide(
    layerHandlers({
      callbackUrl: "https://shop.example/webhooks/shamcash",
      redirectUrl: "https://shop.example/checkout/return",
      resolve: (ref) =>
        Effect.gen(function* () {
          const order = orders.get(ref)
          if (!order) {
            return yield* new ShamCashPaymentError({ reason: "NotFound", message: "No such order" })
          }
          order.attempts += 1
          return {
            billNo: `${ref}-${order.attempts}`,
            amount: order.total,
            currency: "USD" as const,
          }
        }),
    }),
  ),
  Layer.provide(RpcSerialization.layerJson),
)

const WebhookLive = layerWebhook({
  path: "/webhooks/shamcash",
  // Idempotent: ShamCash may redeliver. Dedupe on billNo.
  onEvent: (event) => Effect.log("bill settled", event.billNo, event.statusId),
})

const { handler } = HttpRouter.toWebHandler(
  Layer.mergeAll(RpcLive, WebhookLive).pipe(Layer.provide(ShamCashLive)),
)

// wrap: Bun passes the server as a 2nd arg, which toWebHandler would read as context
Bun.serve({ port: 3000, fetch: (request) => handler(request) })
