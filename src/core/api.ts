import { resolve, type ShamCashConfig } from "./config.ts"
import { ShamCashError } from "./errors.ts"
import { decrypt, verifyClaims } from "./jwe.ts"
import {
  createBillPayload,
  Endpoint,
  encodeRequest,
  endpointUrl,
  getBillPayload,
  parseResponse,
  refundPayload,
  toWebhookEvent,
  transactionsPayload,
  webhookToken,
} from "./protocol.ts"
import type {
  Bill,
  CreateBillInput,
  RefundInput,
  RefundResult,
  Transaction,
  TransactionsPage,
  TransactionsQuery,
  WebhookEvent,
} from "./types.ts"

const call = async (config: ShamCashConfig, endpoint: Endpoint, payload: object) => {
  const r = resolve(config)
  const body = await encodeRequest(await r.key, r.agentKey, payload, r.now(), r.tokenTtlSeconds)
  let response: Response
  let text: string
  try {
    response = await r.fetch(endpointUrl(r.baseUrl, endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(r.timeoutMs),
    })
    text = await response.text()
  } catch (cause) {
    throw new ShamCashError("network", `Request to ShamCash ${endpoint} failed`, { cause })
  }
  return parseResponse(response.status, text)
}

/**
 * Create a bill and get its `paymentUrl`. Create it just-in-time, when the user
 * clicks pay: the bill expires 10 minutes after creation.
 *
 * On a retry after a network failure, `code === ResultCode.BillNoAlreadyExists`
 * means the first attempt went through — use `getBill`.
 */
export const createBill = async (config: ShamCashConfig, input: CreateBillInput): Promise<Bill> =>
  (await call(config, Endpoint.createBill, createBillPayload(input))) as Bill

/**
 * Fetch a bill. Use as a one-off fallback when no webhook arrived 10+ minutes
 * after creation — not as a polling loop.
 */
export const getBill = async (config: ShamCashConfig, billNo: string): Promise<Bill> =>
  (await call(config, Endpoint.getBillInfo, getBillPayload(billNo))) as Bill

/**
 * Full or partial refund. Persist the returned `idempotencyKey` and reuse it
 * when retrying: a key that already succeeded returns the original `tranId`.
 */
export const refund = async (config: ShamCashConfig, input: RefundInput): Promise<RefundResult> => {
  const payload = refundPayload(input, () => crypto.randomUUID())
  const data = (await call(config, Endpoint.refundBill, payload)) as {
    tranId: number
  }
  return { tranId: data.tranId, idempotencyKey: payload.idempotencyKey }
}

/** One page of the transaction ledger (payments and refunds). */
export const getTransactions = async (
  config: ShamCashConfig,
  query?: TransactionsQuery,
): Promise<TransactionsPage> =>
  (await call(config, Endpoint.getTransactions, transactionsPayload(query))) as TransactionsPage

/** Every transaction matching the query, following the cursor across pages. */
export async function* transactions(
  config: ShamCashConfig,
  query: TransactionsQuery = {},
): AsyncGenerator<Transaction, void, undefined> {
  let afterTranId = query.afterTranId ?? 0
  while (true) {
    const page = await getTransactions(config, { ...query, afterTranId })
    yield* page.list
    if (!page.hasMore || page.list.length === 0) return
    afterTranId = page.lastReturnedTranId
  }
}

/**
 * Decrypt and verify a webhook body (raw string or parsed JSON).
 * Rejects tampered or expired payloads. Handlers must still be idempotent:
 * ShamCash may deliver the same event more than once.
 */
export const parseWebhook = async (
  config: ShamCashConfig,
  body: unknown,
): Promise<WebhookEvent> => {
  const r = resolve(config)
  const payload = await decrypt(await r.key, webhookToken(body))
  verifyClaims(payload, r.now(), r.clockSkewSeconds)
  return toWebhookEvent(payload)
}
