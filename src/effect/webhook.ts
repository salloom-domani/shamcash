import { Effect, Layer } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { ShamCash } from "./ShamCash.ts"
import type { WebhookEvent } from "./schema.ts"

export interface WebhookOptions<E, R> {
  /** Route path, e.g. `/webhooks/shamcash`. Must match the bill's `callbackUrl`. */
  readonly path: `/${string}`
  /**
   * Handle one verified event. Must be idempotent (dedupe on `billNo`) and
   * finish within ShamCash's 10s window. Failing yields a 500 so ShamCash retries.
   */
  readonly onEvent: (event: WebhookEvent) => Effect.Effect<void, E, R>
}

const text = (body: string, status: number) => HttpServerResponse.text(body, { status })

/** `HttpRouter` route for ShamCash webhooks. Requires the `ShamCash` service. */
export const layerWebhook = <E, R>(options: WebhookOptions<E, R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const shamcash = yield* ShamCash
      return HttpRouter.add("POST", options.path, (request: HttpServerRequest.HttpServerRequest) =>
        request.text.pipe(
          Effect.flatMap(shamcash.parseWebhook),
          Effect.matchEffect({
            // invalid/tampered/expired deliveries are not retryable
            onFailure: (error) =>
              Effect.as(
                Effect.logWarning("ShamCash webhook rejected", error),
                text("Bad Request", 400),
              ),
            onSuccess: (event) =>
              options.onEvent(event).pipe(
                Effect.as(text("OK", 200)),
                Effect.catchCause((cause) =>
                  Effect.as(
                    Effect.logError("ShamCash webhook handler failed", cause),
                    text("Internal Server Error", 500),
                  ),
                ),
              ),
          }),
          Effect.withSpan("ShamCash.webhook"),
        ),
      )
    }),
  )
