// Browser side: start a payment over RPC, then hand off to ShamCash.
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { openPayment } from "shamcash/client"
import { ShamCashRpcs } from "shamcash/effect/rpc"

const ProtocolLive = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide([RpcSerialization.layerJson, FetchHttpClient.layer]),
)

export const pay = (orderId: string) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(ShamCashRpcs)
    const session = yield* client["ShamCash.StartPayment"]({ ref: orderId })
    openPayment(session.paymentUrl)
  }).pipe(Effect.scoped, Effect.provide(ProtocolLive))

/** On the `redirectUrl` page: ask your server, not the URL, what happened. */
export const checkStatus = (billNo: string) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(ShamCashRpcs)
    return yield* client["ShamCash.GetPaymentStatus"]({ billNo })
  }).pipe(Effect.scoped, Effect.provide(ProtocolLive))
