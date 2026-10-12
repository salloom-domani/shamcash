/**
 * Transport-agnostic protocol pieces shared by the Promise and Effect clients:
 * payload builders (with validation), request encoding and envelope parsing.
 */
import { BillStatus, Currency, ResultCode } from "./codes.ts"
import { ShamCashError } from "./errors.ts"
import { encrypt, withClaims } from "./jwe.ts"
import type {
  CreateBillInput,
  Envelope,
  RefundInput,
  TransactionsQuery,
  WebhookEvent,
} from "./types.ts"
import * as v from "./validate.ts"

export const Endpoint = {
  createBill: "createBill",
  getBillInfo: "getBillInfo",
  refundBill: "refundBill",
  getTransactions: "getTransactions",
} as const
export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]

export const DEFAULT_TOKEN_TTL_SECONDS = 300
export const DEFAULT_CLOCK_SKEW_SECONDS = 60
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_PAGE_LIMIT = 500

export const endpointUrl = (baseUrl: string, endpoint: Endpoint): string =>
  `${baseUrl.replace(/\/+$/, "")}/api/ElectronicPayment/${endpoint}`

export const createBillPayload = (input: CreateBillInput) => {
  const currencyId = Currency[input.currency]
  if (currencyId === undefined) {
    throw new ShamCashError("validation", "currency must be one of: USD, SYP")
  }
  const note = v.optionalString("note", input.note)
  return {
    billNo: v.nonEmpty("billNo", input.billNo),
    amount: v.amount("amount", input.amount),
    currencyId,
    callbackUrl: v.httpUrl("callbackUrl", input.callbackUrl),
    redirectUrl: v.httpUrl("redirectUrl", input.redirectUrl),
    ...(note === undefined ? {} : { note }),
  }
}

export const getBillPayload = (billNo: string) => ({
  billNo: v.nonEmpty("billNo", billNo),
})

export const refundPayload = (input: RefundInput, generateKey: () => string) => {
  const note = v.optionalString("note", input.note)
  return {
    billNo: v.nonEmpty("billNo", input.billNo),
    amount: v.amount("amount", input.amount),
    idempotencyKey: v.idempotencyKey(input.idempotencyKey ?? generateKey()),
    ...(note === undefined ? {} : { note }),
  }
}

export const transactionsPayload = (query: TransactionsQuery = {}) => ({
  fromDate: v.optionalDate("fromDate", query.fromDate),
  toDate: v.optionalDate("toDate", query.toDate),
  afterTranId: v.intInRange("afterTranId", query.afterTranId ?? 0, 0, Number.MAX_SAFE_INTEGER),
  limit: v.intInRange("limit", query.limit ?? DEFAULT_PAGE_LIMIT, 10, 2500),
})

/** Build the JSON request body `{ agentKey, encData }`. */
export const encodeRequest = async (
  key: CryptoKey,
  agentKey: string,
  payload: object,
  nowMs: number,
  ttlSeconds: number,
): Promise<string> =>
  JSON.stringify({
    agentKey,
    encData: await encrypt(key, withClaims(payload, nowMs, ttlSeconds)),
  })

const isEnvelope = (u: unknown): u is Envelope =>
  typeof u === "object" &&
  u !== null &&
  typeof (u as Envelope).result === "number" &&
  typeof (u as Envelope).succeeded === "boolean"

/**
 * Interpret an HTTP response. HTTP 200 only means "processed" — success is
 * `result === 2500` (spec §7.2). Returns `data` or throws `ShamCashError`.
 */
export const parseResponse = (status: number, text: string): unknown => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  if (status !== 200) {
    const message = isEnvelope(body) && body.message ? body.message : `HTTP ${status} from ShamCash`
    throw new ShamCashError("http", message, { status })
  }
  if (!isEnvelope(body)) {
    throw new ShamCashError("decode", "Response is not a ShamCash envelope", {
      status,
    })
  }
  if (body.result !== ResultCode.Success || !body.succeeded) {
    throw new ShamCashError("api", body.message || `ShamCash error ${body.result}`, {
      code: body.result,
      status,
    })
  }
  return body.data
}

/** Extract `encData` from a webhook request body (string or parsed JSON). */
export const webhookToken = (body: unknown): string => {
  let parsed = body
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body)
    } catch (cause) {
      throw new ShamCashError("decode", "Webhook body is not JSON", { cause })
    }
  }
  const encData = (parsed as { encData?: unknown } | null)?.encData
  if (typeof encData !== "string" || encData === "") {
    throw new ShamCashError("decode", "Webhook body is missing encData")
  }
  return encData
}

/** Validate a decrypted webhook payload. */
export const toWebhookEvent = (payload: unknown): WebhookEvent => {
  const p = payload as Record<string, unknown>
  const valid =
    typeof p.billNo === "string" &&
    (p.statusId === BillStatus.Paid || p.statusId === BillStatus.Expired) &&
    (p.tranId === null || p.tranId === undefined || typeof p.tranId === "number") &&
    typeof p.exp === "number"
  if (!valid) throw new ShamCashError("decode", "Webhook payload has an unexpected shape")
  return {
    billNo: p.billNo as string,
    tranId: (p.tranId as number | null | undefined) ?? null,
    statusId: p.statusId as WebhookEvent["statusId"],
    iat: typeof p.iat === "number" ? p.iat : (p.exp as number) - DEFAULT_TOKEN_TTL_SECONDS,
    exp: p.exp as number,
  }
}
