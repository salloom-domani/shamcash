# @siters/shamcash

Unofficial TypeScript SDK for the ShamCash E-Payment API (spec v1.0.0).

- **Runtime-agnostic** — Web APIs only (`fetch`, `crypto.subtle`). Node ≥ 22.12, Bun, Deno, Cloudflare Workers, Vercel Edge.
- **Zero dependencies**, ESM, tree-shakable (`sideEffects: false`, standalone functions, per-feature entry points).
- **First-class [Effect](https://effect.website)** — service + layers, Schema-decoded responses, tagged errors, `Stream` pagination, webhook route, RPC contract.
- Direct JWE (`dir` + `A256GCM`) implemented on WebCrypto, verified against [`jose`](https://github.com/panva/jose) in tests.

> Not affiliated with ShamCash or SandLogix. You need a verified ShamCash commercial account and the `agentKey`, `secretKey` and `baseUrl` they issue.

```sh
bun add @siters/shamcash   # or npm i / pnpm add / deno add npm:@siters/shamcash
```

## Entry points

| Import | Where | What |
|---|---|---|
| `@siters/shamcash` | server | `createBill`, `getBill`, `refund`, `getTransactions`, `transactions`, `parseWebhook`, `createShamCash`, errors, codes |
| `@siters/shamcash/webhook` | server | `createWebhookHandler` — `(Request) => Promise<Response>` |
| `@siters/shamcash/client` | browser / app | `openPayment`, status helpers, types. No secrets, no crypto |
| `@siters/shamcash/effect` | server | `ShamCash` service, `layer`, `layerConfig`, `layerWebhook`, tagged errors, schemas |
| `@siters/shamcash/effect/rpc` | shared | `ShamCashRpcs` group (`StartPayment`, `GetPaymentStatus`) |
| `@siters/shamcash/effect/rpc/server` | server | `layerHandlers` for `ShamCashRpcs` |

`effect@^4` is an optional peer dependency, only needed for `@siters/shamcash/effect*`.

## How a payment works

1. User clicks **Pay** → your server calls `createBill` → gets `paymentUrl`. The bill expires in **10 minutes**.
2. Your frontend sends the user to `paymentUrl` (ShamCash app if installed, web checkout otherwise).
3. User confirms; ShamCash redirects the browser to your `redirectUrl` (no status in the URL).
4. ShamCash POSTs an encrypted webhook to your `callbackUrl` when the bill is **paid** or **expired**.
5. No webhook after 10+ minutes? Call `getBill` **once** to reconcile. Don't poll.

## Quick start

```ts
import { createBill, getBill, isShamCashError, ResultCode } from "@siters/shamcash"

const config = {
  agentKey: process.env.SHAMCASH_AGENT_KEY!,
  secretKey: process.env.SHAMCASH_SECRET_KEY!, // base64, never ship to clients
  baseUrl: process.env.SHAMCASH_BASE_URL!,
}

const bill = await createBill(config, {
  billNo: `${order.id}-${order.attempt}`, // unique per attempt
  amount: "10.50",                         // string or number, ≤ 2 decimals
  currency: "USD",                         // "USD" | "SYP"
  callbackUrl: "https://shop.example/webhooks/shamcash",
  redirectUrl: "https://shop.example/checkout/return",
  note: `Order ${order.id}`,
})
// → send bill.paymentUrl to the frontend
```

Prefer an object? `createShamCash(config)` binds every function (not tree-shaken).

Options: `fetch`, `timeoutMs` (30s), `tokenTtlSeconds` (300), `clockSkewSeconds` (60), `now`.

### Retrying `createBill`

If the network drops mid-request and the retry fails with `1704 Bill No Already Exists`, the first request went through:

```ts
try {
  return await createBill(config, input)
} catch (e) {
  if (isShamCashError(e) && e.code === ResultCode.BillNoAlreadyExists) return getBill(config, input.billNo)
  throw e
}
```

## Webhooks

`createWebhookHandler` decrypts, authenticates and checks `exp`, then calls `onEvent`. It answers `200` on success, `400` for invalid/tampered/expired deliveries, `500` if `onEvent` throws (so ShamCash retries), `405` for non-POST.

```ts
import { BillStatus } from "@siters/shamcash"
import { createWebhookHandler } from "@siters/shamcash/webhook"

export const webhook = createWebhookHandler(config, {
  // Must be idempotent (ShamCash may redeliver) and finish within 10s.
  async onEvent(event) {
    if (event.statusId === BillStatus.Paid) await orders.markPaid(event.billNo, event.tranId)
    else await orders.markExpired(event.billNo)
  },
  onError: (error) => console.warn("shamcash webhook", error),
})
```

Mount it anywhere that speaks `Request`/`Response`:

```ts
// Bun
Bun.serve({ routes: { "/webhooks/shamcash": webhook } })

// Deno
Deno.serve(webhook)

// Hono
app.post("/webhooks/shamcash", (c) => webhook(c.req.raw))

// Elysia (mount hands over the untouched Request)
app.mount("/webhooks/shamcash", webhook)

// Next.js App Router — app/webhooks/shamcash/route.ts
export { webhook as POST }

// SvelteKit — +server.ts
export const POST = ({ request }) => webhook(request)

// Remix / React Router
export const action = ({ request }) => webhook(request)

// Cloudflare Workers (secrets live on env)
export default {
  fetch: (request, env) =>
    createWebhookHandler(
      { agentKey: env.SHAMCASH_AGENT_KEY, secretKey: env.SHAMCASH_SECRET_KEY, baseUrl: env.SHAMCASH_BASE_URL },
      { onEvent },
    )(request),
}
```

Node frameworks without `Request` use `parseWebhook` directly (accepts a raw string or parsed JSON):

```ts
import { isShamCashError, parseWebhook } from "@siters/shamcash"

// Express
app.post("/webhooks/shamcash", express.json(), async (req, res) => {
  try {
    const event = await parseWebhook(config, req.body)
    await handle(event)
    res.sendStatus(200)
  } catch (e) {
    res.sendStatus(isShamCashError(e) ? 400 : 500)
  }
})

// Fastify
app.post("/webhooks/shamcash", async (request, reply) => {
  try {
    await handle(await parseWebhook(config, request.body))
    return reply.code(200).send("OK")
  } catch (e) {
    return reply.code(isShamCashError(e) ? 400 : 500).send()
  }
})
```

## Frontend

```ts
import { openPayment, isPaid } from "@siters/shamcash/client"

const { paymentUrl } = await fetch("/api/pay", { method: "POST", body: orderId }).then((r) => r.json())
openPayment(paymentUrl)

// React Native / Capacitor: use the system browser, never a WebView
openPayment(paymentUrl, { open: Linking.openURL })
```

On the `redirectUrl` page, ask **your server** for the status — the URL carries none.

## Refunds

```ts
const { tranId, idempotencyKey } = await refund(config, { billNo: "order-1-1", amount: "5.00", note: "Item returned" })
```

Full or partial, any number of times up to the paid total; currency follows the bill. `idempotencyKey` is generated if omitted — **store it** and pass it again when retrying: a key that already succeeded returns the original `tranId` instead of refunding twice.

## Reconciliation

```ts
for await (const tx of transactions(config, { fromDate: "2026-01-01", toDate: "2026-01-31", limit: 1000 })) {
  // tx.tranTypeId: 1 payment, 2 refund
}
```

`getTransactions` returns a single page if you'd rather drive the cursor (`afterTranId` / `lastReturnedTranId`) yourself.

## Errors

Every failure is a `ShamCashError` with a `kind`:

| kind | meaning | extra |
|---|---|---|
| `api` | ShamCash returned a non-success `result` | `code` (see `ResultCode`) |
| `http` | non-200 from ShamCash / gateway | `status` |
| `network` | no response (connection, timeout) | `cause` |
| `decode` | body wasn't the expected shape | |
| `validation` | rejected locally, nothing sent | |
| `crypto` | bad key, tampered or expired token | |

`ResultCode`: `GeneralError 1000`, `BalanceNotEnough 1304`, `ReceiverBlocked 1322`, `EPayCustomError 1700`, `AgentKeyInvalid 1701`, `AgentNotActive 1702`, `BillNotFound 1703`, `BillNoAlreadyExists 1704`, `EncryptedDataInvalid 1705`, `AccountBlocked 1706`, `OriginBillNotPaid 1707`, `RefundExceedsBalance 1708`, `Success 2500`.

`BillStatus`: `Pending 1`, `Refunded 2`, `Expired 3`, `Paid 4`, `PartlyRefunded 5`.

## Effect

```ts
import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { layerConfig, ShamCash } from "@siters/shamcash/effect"

// SHAMCASH_AGENT_KEY / SHAMCASH_SECRET_KEY (Redacted) / SHAMCASH_BASE_URL
const ShamCashLive = layerConfig().pipe(Layer.provide(FetchHttpClient.layer))

const program = Effect.gen(function* () {
  const shamcash = yield* ShamCash
  const bill = yield* shamcash.createBill({ billNo: "order-1-1", amount: "10.50", currency: "USD", callbackUrl, redirectUrl })
  const ledger = yield* Stream.runCollect(shamcash.transactions({ fromDate: "2026-01-01" }))
}).pipe(
  Effect.catchTag("ShamCashApiError", (e) => Effect.logWarning(e.code, e.message)),
  Effect.provide(ShamCashLive),
)
```

- Uses Effect's `HttpClient` (bring your own: tracing, retries, proxies) and `Clock` (testable with `TestClock`).
- Responses are decoded with Schema (`ShamCashSchema.Bill`, …).
- Errors: `ShamCashApiError`, `ShamCashHttpError`, `ShamCashNetworkError`, `ShamCashDecodeError`, `ShamCashValidationError`, `ShamCashCryptoError` — all `Schema.TaggedError`.
- `layer({ agentKey, secretKey: Redacted.make(...), baseUrl })` for explicit options.

### Webhook route

```ts
import { layerWebhook } from "@siters/shamcash/effect"

const WebhookLive = layerWebhook({
  path: "/webhooks/shamcash",
  onEvent: (event) => Orders.settle(event), // Effect; failure → 500 → ShamCash retries
})
```

### RPC

`@siters/shamcash/effect/rpc` is a small, browser-safe contract: the client names *what* to pay (`ref`), the server decides amount and currency. Refunds and the ledger are never exposed.

- `ShamCash.StartPayment({ ref })` → `{ billNo, paymentUrl }` — resumes automatically after a `1704` retry.
- `ShamCash.GetPaymentStatus({ billNo })` → `{ billNo, statusId, statusName }`.
- Errors reach the client as `ShamCashPaymentError` (`NotFound | Forbidden | Rejected | Unavailable`); upstream details are logged, not leaked.

```ts
// server
import { RpcSerialization, RpcServer } from "effect/rpc"
import { ShamCashRpcs } from "@siters/shamcash/effect/rpc"
import { layerHandlers } from "@siters/shamcash/effect/rpc/server"

const RpcLive = RpcServer.layerHttp({ group: ShamCashRpcs, path: "/rpc", protocol: "http" }).pipe(
  Layer.provide(layerHandlers({
    callbackUrl, redirectUrl,
    resolve: (ref) => Orders.nextAttempt(ref),          // → { billNo, amount, currency, note? }
    authorizeStatus: (billNo) => Orders.ownedByCaller(billNo), // optional
  })),
  Layer.provide(RpcSerialization.layerJson),
)

const { handler } = HttpRouter.toWebHandler(Layer.mergeAll(RpcLive, WebhookLive).pipe(Layer.provide(ShamCashLive)))
Bun.serve({ fetch: (request) => handler(request) }) // wrap: Bun's 2nd arg is not an Effect context
```

```ts
// browser
const client = yield* RpcClient.make(ShamCashRpcs)
const { paymentUrl } = yield* client["ShamCash.StartPayment"]({ ref: orderId })
openPayment(paymentUrl)
```

Full runnable versions: [`examples/effect-server.ts`](examples/effect-server.ts), [`examples/effect-client.ts`](examples/effect-client.ts).

## Good practice (from the ShamCash spec)

- **Create bills just-in-time** — when the user clicks pay, not when the cart is created.
- **Don't map order id 1:1 to `billNo`** — use `order-123-1`, `order-123-2`, … so a failed attempt never blocks a retry.
- **Don't poll** `getBill`; rely on the webhook, reconcile once after 10+ minutes.
- **Keep `secretKey` server-side** (env / vault). The root entry refuses to run in a browser.
- **System browser, not WebView**, for `paymentUrl`.
- **Webhook handlers must be idempotent** and answer within 10s.
- Dates/times from ShamCash (`createdDate`, `createdTime`) carry no timezone; they're returned as-is.
- `paymentUrl` embeds a fresh token on every `createBill`/`getBill` call — don't compare or cache it as an identifier; use `billNo`.

## Sandbox

ShamCash support provides a sandbox `baseUrl` and keys. Sandbox checkout accepts the confirmation code `000000`.

## Development

```sh
bun install
bun test            # unit tests (Bun)
bun run typecheck
bun run lint
bun run build       # tsdown → dist/
bun run test:smoke  # built package on Node + Bun (and `deno run -A test/smoke/smoke.mjs`)
bun run check:package
```

## License

MIT
