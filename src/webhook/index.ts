import { parseWebhook } from "../core/api.ts"
import type { ShamCashConfig } from "../core/config.ts"
import { isShamCashError } from "../core/errors.ts"
import type { WebhookEvent } from "../core/types.ts"

export interface WebhookHandlerOptions {
  /**
   * Called once per verified event. Must be idempotent (dedupe on `billNo`)
   * and finish within ShamCash's 10s window. Throwing yields a 500 so
   * ShamCash retries.
   */
  readonly onEvent: (event: WebhookEvent, request: Request) => void | Promise<void>
  /** Observe rejected deliveries and handler failures. */
  readonly onError?: ((error: unknown, request: Request) => void) | undefined
}

const text = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })

/**
 * Web-standard webhook handler: `(Request) => Promise<Response>`.
 * Works as-is with Bun.serve, Deno.serve, Hono, Elysia, Next.js route
 * handlers, SvelteKit, Remix, Cloudflare Workers. For Node frameworks
 * (Express, Fastify) call `parseWebhook` from `@siters/shamcash` directly.
 */
export const createWebhookHandler =
  (config: ShamCashConfig, options: WebhookHandlerOptions) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return text(405, "Method Not Allowed")
    let event: WebhookEvent
    try {
      event = await parseWebhook(config, await request.text())
    } catch (error) {
      options.onError?.(error, request)
      // invalid/tampered/expired deliveries are not retryable
      return isShamCashError(error) ? text(400, "Bad Request") : text(500, "Internal Server Error")
    }
    try {
      await options.onEvent(event, request)
    } catch (error) {
      options.onError?.(error, request)
      return text(500, "Internal Server Error")
    }
    return text(200, "OK")
  }

export type { WebhookEvent } from "../core/types.ts"
