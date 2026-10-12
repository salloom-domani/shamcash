export type ShamCashErrorKind =
  /** API returned 200 with a non-success `result` code. */
  | "api"
  /** Non-200 HTTP response (gateway / proxy / malformed request). */
  | "http"
  /** Network failure or timeout before a response arrived. */
  | "network"
  /** Response body was not the expected JSON envelope. */
  | "decode"
  /** Input failed local validation; nothing was sent. */
  | "validation"
  /** JWE could not be decrypted / verified, or its claims are invalid. */
  | "crypto"

export interface ShamCashErrorOptions {
  readonly code?: number | undefined
  readonly status?: number | undefined
  readonly cause?: unknown
}

export class ShamCashError extends Error {
  override readonly name = "ShamCashError"
  readonly kind: ShamCashErrorKind
  /** Application result code (`kind === "api"`). */
  readonly code: number | undefined
  /** HTTP status, when a response was received. */
  readonly status: number | undefined

  constructor(kind: ShamCashErrorKind, message: string, options: ShamCashErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.kind = kind
    this.code = options.code
    this.status = options.status
  }
}

export const isShamCashError = (u: unknown): u is ShamCashError => u instanceof ShamCashError
