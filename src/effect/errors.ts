import { Schema } from "effect"
import { isShamCashError } from "../core/errors.ts"

/** ShamCash answered with a non-success `result` code (see `ResultCode`). */
export class ShamCashApiError extends Schema.TaggedError<ShamCashApiError>()("ShamCashApiError", {
  code: Schema.Number,
  message: Schema.String,
}) {}

/** Non-200 HTTP status from ShamCash or its gateway. */
export class ShamCashHttpError extends Schema.TaggedError<ShamCashHttpError>()(
  "ShamCashHttpError",
  { status: Schema.Number, message: Schema.String },
) {}

/** No response: connection failure, timeout, aborted. */
export class ShamCashNetworkError extends Schema.TaggedError<ShamCashNetworkError>()(
  "ShamCashNetworkError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

/** Response or webhook body did not match the expected shape. */
export class ShamCashDecodeError extends Schema.TaggedError<ShamCashDecodeError>()(
  "ShamCashDecodeError",
  { message: Schema.String },
) {}

/** Input rejected locally; nothing was sent. */
export class ShamCashValidationError extends Schema.TaggedError<ShamCashValidationError>()(
  "ShamCashValidationError",
  { message: Schema.String },
) {}

/** Bad secret key, or a token that failed decryption / claims checks. */
export class ShamCashCryptoError extends Schema.TaggedError<ShamCashCryptoError>()(
  "ShamCashCryptoError",
  { message: Schema.String },
) {}

export type ShamCashError =
  | ShamCashApiError
  | ShamCashHttpError
  | ShamCashNetworkError
  | ShamCashDecodeError
  | ShamCashValidationError
  | ShamCashCryptoError

/** Map a core `ShamCashError` (or anything thrown) to its tagged counterpart. */
export const fromUnknown = (u: unknown): ShamCashError => {
  if (!isShamCashError(u)) {
    return new ShamCashNetworkError({
      message: String((u as Error)?.message ?? u),
      cause: u,
    })
  }
  switch (u.kind) {
    case "api":
      return new ShamCashApiError({ code: u.code ?? 0, message: u.message })
    case "http":
      return new ShamCashHttpError({
        status: u.status ?? 0,
        message: u.message,
      })
    case "network":
      return new ShamCashNetworkError({ message: u.message, cause: u.cause })
    case "decode":
      return new ShamCashDecodeError({ message: u.message })
    case "validation":
      return new ShamCashValidationError({ message: u.message })
    case "crypto":
      return new ShamCashCryptoError({ message: u.message })
  }
}
