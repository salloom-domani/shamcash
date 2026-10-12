/** Application result codes (spec §7.1). */
export const ResultCode = {
  GeneralError: 1000,
  BalanceNotEnough: 1304,
  ReceiverBlocked: 1322,
  EPayCustomError: 1700,
  AgentKeyInvalid: 1701,
  AgentNotActive: 1702,
  BillNotFound: 1703,
  BillNoAlreadyExists: 1704,
  EncryptedDataInvalid: 1705,
  AccountBlocked: 1706,
  OriginBillNotPaid: 1707,
  RefundExceedsBalance: 1708,
  Success: 2500,
} as const
export type ResultCode = (typeof ResultCode)[keyof typeof ResultCode]

/** Bill status ids (spec §6.3). */
export const BillStatus = {
  Pending: 1,
  Refunded: 2,
  Expired: 3,
  Paid: 4,
  PartlyRefunded: 5,
} as const
export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus]

export const Currency = { USD: 1, SYP: 2 } as const
export type Currency = keyof typeof Currency
export type CurrencyId = (typeof Currency)[Currency]

export const TranType = { Payment: 1, Refund: 2 } as const
export type TranType = (typeof TranType)[keyof typeof TranType]

/** Map a numeric currency id back to its code. */
export const currencyFromId = (id: number): Currency | undefined =>
  id === 1 ? "USD" : id === 2 ? "SYP" : undefined
