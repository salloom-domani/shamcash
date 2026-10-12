import { Effect } from "effect"
import { BillStatus, type Currency, ResultCode } from "../../core/codes.ts"
import type { Amount } from "../../core/types.ts"
import type { ShamCashError } from "../errors.ts"
import { ShamCash } from "../ShamCash.ts"
import { ShamCashPaymentError, ShamCashRpcs } from "./index.ts"

export interface PaymentDetails {
  /**
   * Unique per attempt; reuse it only to resume the same attempt.
   * Suggested: `${orderId}-${attempt}`.
   */
  readonly billNo: string
  readonly amount: Amount
  readonly currency: Currency
  readonly note?: string | undefined
  /** Overrides `options.callbackUrl`. */
  readonly callbackUrl?: string | undefined
  /** Overrides `options.redirectUrl`. */
  readonly redirectUrl?: string | undefined
}

export interface HandlerOptions<R1, R2> {
  /** Webhook URL (see `layerWebhook`). */
  readonly callbackUrl: string
  /** Where the browser returns after checkout. */
  readonly redirectUrl: string
  /**
   * Turn a client `ref` into bill details, server-side. Look up the order,
   * check ownership, pick the next attempt's `billNo`.
   */
  readonly resolve: (ref: string) => Effect.Effect<PaymentDetails, ShamCashPaymentError, R1>
  /**
   * Gate `GetPaymentStatus`, e.g. check the bill belongs to the caller.
   * Defaults to allow-all (only status fields are returned).
   */
  readonly authorizeStatus?:
    | ((billNo: string) => Effect.Effect<void, ShamCashPaymentError, R2>)
    | undefined
}

/** Never leak upstream details to the client; log them instead. */
const toPaymentError = (error: ShamCashError) =>
  Effect.logWarning("ShamCash request failed", error).pipe(
    Effect.andThen(
      Effect.fail(
        error._tag === "ShamCashApiError" && error.code === ResultCode.BillNotFound
          ? new ShamCashPaymentError({
              reason: "NotFound",
              message: "Bill not found",
            })
          : error._tag === "ShamCashApiError" || error._tag === "ShamCashValidationError"
            ? new ShamCashPaymentError({
                reason: "Rejected",
                message: "Payment was rejected",
              })
            : new ShamCashPaymentError({
                reason: "Unavailable",
                message: "Payment service unavailable",
              }),
      ),
    ),
  )

/** Server handlers for `ShamCashRpcs`. Requires the `ShamCash` service. */
export const layerHandlers = <R1 = never, R2 = never>(options: HandlerOptions<R1, R2>) =>
  ShamCashRpcs.toLayer(
    Effect.gen(function* () {
      const shamcash = yield* ShamCash
      return ShamCashRpcs.of({
        "ShamCash.StartPayment": ({ ref }) =>
          Effect.gen(function* () {
            const details = yield* options.resolve(ref)
            const bill = yield* shamcash
              .createBill({
                billNo: details.billNo,
                amount: details.amount,
                currency: details.currency,
                note: details.note,
                callbackUrl: details.callbackUrl ?? options.callbackUrl,
                redirectUrl: details.redirectUrl ?? options.redirectUrl,
              })
              .pipe(
                // a retried request that already went through (spec §10)
                Effect.catchIf(
                  (e) => e._tag === "ShamCashApiError" && e.code === ResultCode.BillNoAlreadyExists,
                  () => shamcash.getBill(details.billNo),
                ),
                Effect.catch(toPaymentError),
              )
            if (bill.statusId !== BillStatus.Pending) {
              return yield* new ShamCashPaymentError({
                reason: "Rejected",
                message: "Bill is no longer pending; start a new attempt",
              })
            }
            return { billNo: bill.billNo, paymentUrl: bill.paymentUrl }
          }),
        "ShamCash.GetPaymentStatus": ({ billNo }) =>
          Effect.gen(function* () {
            if (options.authorizeStatus) yield* options.authorizeStatus(billNo)
            const bill = yield* shamcash.getBill(billNo).pipe(Effect.catch(toPaymentError))
            return {
              billNo: bill.billNo,
              statusId: bill.statusId,
              statusName: bill.statusName,
            }
          }),
      })
    }),
  )

export { ShamCashPaymentError, ShamCashRpcs } from "./index.ts"
