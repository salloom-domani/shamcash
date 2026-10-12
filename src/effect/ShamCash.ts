import { Clock, Config, Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { decrypt, importSecretKey, verifyClaims } from "../core/jwe.ts"
import {
  createBillPayload,
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_TOKEN_TTL_SECONDS,
  Endpoint,
  encodeRequest,
  endpointUrl,
  getBillPayload,
  parseResponse,
  refundPayload,
  toWebhookEvent,
  transactionsPayload,
  webhookToken,
} from "../core/protocol.ts"
import type { CreateBillInput, RefundInput, TransactionsQuery } from "../core/types.ts"
import {
  fromUnknown,
  ShamCashCryptoError,
  ShamCashDecodeError,
  type ShamCashError,
  ShamCashNetworkError,
} from "./errors.ts"
import * as S from "./schema.ts"

export interface ShamCashOptions {
  readonly agentKey: string
  readonly secretKey: Redacted.Redacted<string>
  readonly baseUrl: string
  /** Lifetime of request tokens. Default 300s. */
  readonly tokenTtlSeconds?: number | undefined
  /** Tolerance for webhook `iat`/`exp`. Default 60s. */
  readonly clockSkewSeconds?: number | undefined
}

export class ShamCash extends Context.Service<
  ShamCash,
  {
    /** Create a bill just-in-time; redirect the user to `paymentUrl`. */
    readonly createBill: (input: CreateBillInput) => Effect.Effect<S.Bill, ShamCashError>
    /** One-off fallback when no webhook arrived — not for polling. */
    readonly getBill: (billNo: string) => Effect.Effect<S.Bill, ShamCashError>
    /** Persist the returned `idempotencyKey` and reuse it on retry. */
    readonly refund: (input: RefundInput) => Effect.Effect<S.RefundResult, ShamCashError>
    readonly getTransactions: (
      query?: TransactionsQuery,
    ) => Effect.Effect<S.TransactionsPage, ShamCashError>
    /** Every matching transaction, following the cursor lazily. */
    readonly transactions: (
      query?: TransactionsQuery,
    ) => Stream.Stream<S.Transaction, ShamCashError>
    /** Decrypt + verify a webhook body (raw string or parsed JSON). */
    readonly parseWebhook: (
      body: unknown,
    ) => Effect.Effect<S.WebhookEvent, ShamCashCryptoError | ShamCashDecodeError>
  }
>()("shamcash/ShamCash") {}

const attempt = <A>(f: () => A) => Effect.try({ try: f, catch: fromUnknown })
const attemptPromise = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: fromUnknown })

const decodeWith =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (u: unknown) =>
    Schema.decodeUnknownEffect(schema)(u).pipe(
      Effect.mapError((issue) => new ShamCashDecodeError({ message: String(issue) })),
    )

/** Build the service. Requires an `HttpClient` (e.g. `FetchHttpClient.layer`). */
export const make = Effect.fnUntraced(function* (options: ShamCashOptions) {
  const http = yield* HttpClient.HttpClient
  const key = yield* attemptPromise(() => importSecretKey(Redacted.value(options.secretKey))).pipe(
    Effect.mapError((e) => new ShamCashCryptoError({ message: e.message })),
  )
  const ttl = options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS
  const skew = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS

  const call = <A>(endpoint: Endpoint, build: () => object, schema: Schema.Codec<A, unknown>) =>
    Effect.gen(function* () {
      const payload = yield* attempt(build)
      const now = yield* Clock.currentTimeMillis
      const body = yield* attemptPromise(() =>
        encodeRequest(key, options.agentKey, payload, now, ttl),
      )
      const response = yield* http
        .execute(
          HttpClientRequest.post(endpointUrl(options.baseUrl, endpoint)).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyText(body, "application/json"),
          ),
        )
        .pipe(
          Effect.flatMap((res) => Effect.map(res.text, (text) => [res.status, text] as const)),
          Effect.mapError(
            (cause) =>
              new ShamCashNetworkError({
                message: `Request to ShamCash ${endpoint} failed`,
                cause,
              }),
          ),
        )
      const data = yield* attempt(() => parseResponse(response[0], response[1]))
      return yield* decodeWith(schema)(data)
    }).pipe(Effect.withSpan(`ShamCash.${endpoint}`))

  const getTransactions = (query?: TransactionsQuery) =>
    call(Endpoint.getTransactions, () => transactionsPayload(query), S.TransactionsPage)

  return ShamCash.of({
    createBill: (input) => call(Endpoint.createBill, () => createBillPayload(input), S.Bill),
    getBill: (billNo) => call(Endpoint.getBillInfo, () => getBillPayload(billNo), S.Bill),
    refund: (input) =>
      Effect.gen(function* () {
        const payload = yield* attempt(() => refundPayload(input, () => crypto.randomUUID()))
        const data = yield* call(
          Endpoint.refundBill,
          () => payload,
          Schema.Struct({ tranId: Schema.Number }),
        )
        return { tranId: data.tranId, idempotencyKey: payload.idempotencyKey }
      }),
    getTransactions,
    transactions: (query = {}) =>
      Stream.paginate(query.afterTranId ?? 0, (afterTranId) =>
        Effect.map(getTransactions({ ...query, afterTranId }), (page) => {
          const next =
            page.hasMore && page.list.length > 0
              ? Option.some(page.lastReturnedTranId)
              : Option.none()
          return [page.list, next] as const
        }),
      ),
    parseWebhook: (body) =>
      Effect.gen(function* () {
        const token = yield* attempt(() => webhookToken(body))
        const payload = yield* attemptPromise(() => decrypt(key, token))
        const now = yield* Clock.currentTimeMillis
        yield* attempt(() => verifyClaims(payload, now, skew))
        return yield* attempt(() => toWebhookEvent(payload))
      }).pipe(
        Effect.mapError((e) =>
          e._tag === "ShamCashCryptoError" || e._tag === "ShamCashDecodeError"
            ? e
            : new ShamCashDecodeError({ message: e.message }),
        ),
        Effect.withSpan("ShamCash.parseWebhook"),
      ),
  })
})

/** `ShamCash` layer from explicit options. */
export const layer = (options: ShamCashOptions) => Layer.effect(ShamCash, make(options))

/**
 * `ShamCash` layer from `Config`. Defaults to `SHAMCASH_AGENT_KEY`,
 * `SHAMCASH_SECRET_KEY`, `SHAMCASH_BASE_URL`.
 */
export const layerConfig = (
  config: Config.Config<ShamCashOptions> = Config.all({
    agentKey: Config.String("SHAMCASH_AGENT_KEY"),
    secretKey: Config.Redacted("SHAMCASH_SECRET_KEY"),
    baseUrl: Config.String("SHAMCASH_BASE_URL"),
  }),
) =>
  Layer.effect(
    ShamCash,
    Effect.gen(function* () {
      return yield* make(yield* config)
    }),
  )
