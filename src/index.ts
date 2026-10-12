import {
  createBill,
  getBill,
  getTransactions,
  parseWebhook,
  refund,
  transactions,
} from "./core/api.ts"
import type { ShamCashConfig } from "./core/config.ts"
import type {
  Bill,
  CreateBillInput,
  RefundInput,
  RefundResult,
  Transaction,
  TransactionsPage,
  TransactionsQuery,
  WebhookEvent,
} from "./core/types.ts"

export {
  createBill,
  getBill,
  getTransactions,
  parseWebhook,
  refund,
  transactions,
} from "./core/api.ts"
export type { CurrencyId } from "./core/codes.ts"
export {
  BillStatus,
  Currency,
  currencyFromId,
  ResultCode,
  TranType,
} from "./core/codes.ts"
export type { FetchLike, ShamCashConfig } from "./core/config.ts"
export type { ShamCashErrorKind } from "./core/errors.ts"
export { isShamCashError, ShamCashError } from "./core/errors.ts"
export { decrypt, encrypt, importSecretKey } from "./core/jwe.ts"
export type * from "./core/types.ts"

export interface ShamCash {
  createBill(input: CreateBillInput): Promise<Bill>
  getBill(billNo: string): Promise<Bill>
  refund(input: RefundInput): Promise<RefundResult>
  getTransactions(query?: TransactionsQuery): Promise<TransactionsPage>
  transactions(query?: TransactionsQuery): AsyncGenerator<Transaction, void, undefined>
  parseWebhook(body: unknown): Promise<WebhookEvent>
}

/**
 * Convenience object binding every operation to one config. Import the
 * standalone functions instead if bundle size matters.
 */
export const createShamCash = (config: ShamCashConfig): ShamCash => ({
  createBill: (input) => createBill(config, input),
  getBill: (billNo) => getBill(config, billNo),
  refund: (input) => refund(config, input),
  getTransactions: (query) => getTransactions(config, query),
  transactions: (query) => transactions(config, query),
  parseWebhook: (body) => parseWebhook(config, body),
})
