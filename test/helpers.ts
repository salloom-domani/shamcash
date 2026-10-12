import { decrypt, encrypt, importSecretKey } from "../src/core/jwe.ts"
import type { Envelope } from "../src/core/types.ts"

export const SECRET = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")
export const AGENT_KEY = "agent-test"
export const BASE_URL = "https://sandbox.shamcash.test"

export const key = await importSecretKey(SECRET)

export const ok = <A>(data: A): Envelope<A> => ({
  result: 2500,
  succeeded: true,
  data,
  message: "Success",
})

export const fail = (result: number, message: string): Envelope<null> => ({
  result,
  succeeded: false,
  data: null,
  message,
})

export interface Received {
  readonly endpoint: string
  readonly agentKey: string
  readonly payload: Record<string, unknown>
}

type Reply = Envelope | { status: number; body: string }

/** A fake ShamCash server: decrypts each request and answers via `handler`. */
export const mockServer = (handler: (req: Received) => Reply | Promise<Reply>) => {
  const received: Received[] = []
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const endpoint = new URL(input).pathname.replace("/api/ElectronicPayment/", "")
    const { agentKey, encData } = JSON.parse(String(init.body))
    const payload = (await decrypt(key, encData)) as Record<string, unknown>
    const req = { endpoint, agentKey, payload }
    received.push(req)
    const reply = await handler(req)
    return "status" in reply
      ? new Response(reply.body, { status: reply.status })
      : Response.json(reply)
  }
  return { fetch, received }
}

export const config = (fetch: ReturnType<typeof mockServer>["fetch"]) => ({
  agentKey: AGENT_KEY,
  secretKey: SECRET,
  baseUrl: BASE_URL,
  fetch,
})

export const bill = (overrides: Record<string, unknown> = {}) => ({
  statusId: 1,
  statusName: "pending",
  billNo: "BN-123",
  amount: 10.5,
  currencyId: 1,
  createdDate: "2026-05-19",
  createdTime: "14:37",
  paymentUrl: "https://pay.shamcash.test/b/abc",
  rem: "Example",
  tranId: null,
  refunds: [],
  ...overrides,
})

/** Build a webhook body the way ShamCash would. */
export const webhookBody = async (payload: Record<string, unknown>, nowMs = Date.now()) => {
  const iat = Math.floor(nowMs / 1000)
  return JSON.stringify({
    encData: await encrypt(key, { iat, exp: iat + 300, ...payload }),
  })
}
