/**
 * Effect Schemas for ShamCash payloads. Browser-safe: no secrets, no crypto.
 */
import { Schema } from "effect"
import type * as Core from "../core/types.ts"

export const BillStatusId = Schema.Literals([1, 2, 3, 4, 5])
export const CurrencyId = Schema.Literals([1, 2])
export const Currency = Schema.Literals(["USD", "SYP"])
export const TranTypeId = Schema.Literals([1, 2])

export const Amount = Schema.Union([Schema.Number, Schema.String])

export const Refund = Schema.Struct({
  tranId: Schema.Number,
  amount: Schema.Number,
  createdDate: Schema.String,
  createdTime: Schema.String,
  rem: Schema.NullOr(Schema.String),
})
export type Refund = typeof Refund.Type

export const Bill = Schema.Struct({
  statusId: BillStatusId,
  statusName: Schema.String,
  billNo: Schema.String,
  amount: Schema.Number,
  currencyId: CurrencyId,
  createdDate: Schema.String,
  createdTime: Schema.String,
  tranId: Schema.NullOr(Schema.Number),
  paymentUrl: Schema.String,
  rem: Schema.NullOr(Schema.String),
  refunds: Schema.Array(Refund),
})
export type Bill = typeof Bill.Type

export const RefundResult = Schema.Struct({
  tranId: Schema.Number,
  idempotencyKey: Schema.String,
})
export type RefundResult = typeof RefundResult.Type

export const Transaction = Schema.Struct({
  billNo: Schema.String,
  amount: Schema.Number,
  currencyId: CurrencyId,
  createdDate: Schema.String,
  createdTime: Schema.String,
  tranId: Schema.Number,
  tranTypeId: TranTypeId,
  tranType: Schema.String,
})
export type Transaction = typeof Transaction.Type

export const TransactionsPage = Schema.Struct({
  list: Schema.Array(Transaction),
  hasMore: Schema.Boolean,
  lastReturnedTranId: Schema.Number,
})
export type TransactionsPage = typeof TransactionsPage.Type

export const WebhookEvent = Schema.Struct({
  billNo: Schema.String,
  tranId: Schema.NullOr(Schema.Number),
  statusId: Schema.Literals([3, 4]),
  iat: Schema.Number,
  exp: Schema.Number,
})
export type WebhookEvent = typeof WebhookEvent.Type

// Keep schemas and core types in lockstep.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
export type _Checks = [
  Assert<Same<Bill, Core.Bill>>,
  Assert<Same<Refund, Core.Refund>>,
  Assert<Same<RefundResult, Core.RefundResult>>,
  Assert<Same<Transaction, Core.Transaction>>,
  Assert<Same<TransactionsPage, Core.TransactionsPage>>,
  Assert<Same<WebhookEvent, Core.WebhookEvent>>,
]
