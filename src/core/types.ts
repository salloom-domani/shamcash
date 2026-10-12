import type { BillStatus, Currency, CurrencyId, TranType } from "./codes.ts"

/** Decimal amount. Strings avoid float surprises; max 2 fraction digits either way. */
export type Amount = number | string

export interface CreateBillInput {
  /** Unique per attempt. Prefer `order-123-1` over the raw order id (spec §10). */
  readonly billNo: string
  readonly amount: Amount
  readonly currency: Currency
  /** Absolute http(s) URL, ≤ 500 chars. Receives the webhook. */
  readonly callbackUrl: string
  /** Absolute http(s) URL, ≤ 500 chars. Browser lands here after checkout. */
  readonly redirectUrl: string
  readonly note?: string | undefined
}

export interface Refund {
  readonly tranId: number
  readonly amount: number
  /** `yyyy-MM-dd`, ShamCash server time (no timezone given). */
  readonly createdDate: string
  /** `HH:mm`, ShamCash server time. */
  readonly createdTime: string
  readonly rem: string | null
}

export interface Bill {
  readonly statusId: BillStatus
  readonly statusName: string
  readonly billNo: string
  readonly amount: number
  readonly currencyId: CurrencyId
  readonly createdDate: string
  readonly createdTime: string
  /** Set only once the bill is paid. */
  readonly tranId: number | null
  readonly paymentUrl: string
  readonly rem: string | null
  readonly refunds: ReadonlyArray<Refund>
}

export interface RefundInput {
  readonly billNo: string
  readonly amount: Amount
  /** 10–100 chars. Generated (UUID) when omitted — persist the returned key to retry safely. */
  readonly idempotencyKey?: string | undefined
  readonly note?: string | undefined
}

export interface RefundResult {
  readonly tranId: number
  readonly idempotencyKey: string
}

export interface TransactionsQuery {
  /** `yyyy-MM-dd` */
  readonly fromDate?: string | undefined
  /** `yyyy-MM-dd` */
  readonly toDate?: string | undefined
  /** Cursor: fetch records after this tranId. Default 0. */
  readonly afterTranId?: number | undefined
  /** 10–2500. Default 500. */
  readonly limit?: number | undefined
}

export interface Transaction {
  readonly billNo: string
  readonly amount: number
  readonly currencyId: CurrencyId
  readonly createdDate: string
  readonly createdTime: string
  readonly tranId: number
  readonly tranTypeId: TranType
  readonly tranType: string
}

export interface TransactionsPage {
  readonly list: ReadonlyArray<Transaction>
  readonly hasMore: boolean
  readonly lastReturnedTranId: number
}

/** Decrypted webhook payload (spec §9). */
export interface WebhookEvent {
  readonly billNo: string
  /** Set when paid, `null` when expired. */
  readonly tranId: number | null
  readonly statusId: typeof BillStatus.Paid | typeof BillStatus.Expired
  readonly iat: number
  readonly exp: number
}

/** Raw response envelope (spec §4). */
export interface Envelope<A = unknown> {
  readonly result: number
  readonly succeeded: boolean
  readonly data: A | null
  readonly message: string
}
