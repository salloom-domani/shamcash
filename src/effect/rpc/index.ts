/**
 * Client-facing RPC contract. Browser-safe: share it between your frontend
 * (`RpcClient`) and server (`shamcash/effect/rpc/server`).
 *
 * Deliberately small: the client names *what* to pay (`ref`), the server
 * decides amount and currency. Refunds and the ledger are never exposed.
 */
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { BillStatusId } from "../schema.ts"

export class ShamCashPaymentError extends Schema.TaggedError<ShamCashPaymentError>()(
  "ShamCashPaymentError",
  {
    reason: Schema.Literals(["NotFound", "Forbidden", "Rejected", "Unavailable"]),
    message: Schema.String,
  },
) {}

export const PaymentSession = Schema.Struct({
  billNo: Schema.String,
  paymentUrl: Schema.String,
})
export type PaymentSession = typeof PaymentSession.Type

export const PaymentStatus = Schema.Struct({
  billNo: Schema.String,
  statusId: BillStatusId,
  statusName: Schema.String,
})
export type PaymentStatus = typeof PaymentStatus.Type

/** Create (or resume) a bill for `ref` — e.g. an order id — and get its `paymentUrl`. */
export const StartPayment = Rpc.make("ShamCash.StartPayment", {
  payload: { ref: Schema.String },
  success: PaymentSession,
  error: ShamCashPaymentError,
})

/** Status of a bill, e.g. after the user returns to `redirectUrl`. */
export const GetPaymentStatus = Rpc.make("ShamCash.GetPaymentStatus", {
  payload: { billNo: Schema.String },
  success: PaymentStatus,
  error: ShamCashPaymentError,
})

export class ShamCashRpcs extends RpcGroup.make(StartPayment, GetPaymentStatus) {}
