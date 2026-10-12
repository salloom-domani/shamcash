/**
 * Browser / mobile safe helpers. No secrets, no crypto, no network.
 * The frontend never talks to ShamCash directly: your server creates the bill
 * and hands back `paymentUrl`.
 */
import { BillStatus } from "../core/codes.ts"

export type { CurrencyId } from "../core/codes.ts"
export {
  BillStatus,
  Currency,
  currencyFromId,
  ResultCode,
  TranType,
} from "../core/codes.ts"
export type { Bill, Refund, Transaction, WebhookEvent } from "../core/types.ts"

export const isPaid = (statusId: number): boolean => statusId === BillStatus.Paid

/** Anything but `pending` — the bill will not change by user action anymore. */
export const isFinal = (statusId: number): boolean => statusId !== BillStatus.Pending

export const isRefunded = (statusId: number): boolean =>
  statusId === BillStatus.Refunded || statusId === BillStatus.PartlyRefunded

/** Throws unless `url` is an absolute http(s) URL — guards against `javascript:` injection. */
export const assertPaymentUrl = (url: string): URL => {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("paymentUrl must be an http(s) URL")
  }
  return parsed
}

export interface OpenPaymentOptions {
  /** Replace the current history entry instead of pushing one. */
  readonly replace?: boolean | undefined
  /**
   * Custom opener, e.g. `Linking.openURL` (React Native) or Capacitor's
   * `Browser.open`. Always use the system browser, never an in-app WebView:
   * WebViews break the deep link into the ShamCash app.
   */
  readonly open?: ((url: string) => unknown) | undefined
}

/**
 * Send the user to ShamCash checkout. Opens the ShamCash app when installed
 * (v2.2.5+), otherwise the web checkout.
 */
export const openPayment = (paymentUrl: string, options: OpenPaymentOptions = {}): void => {
  const url = assertPaymentUrl(paymentUrl).href
  if (options.open) {
    options.open(url)
    return
  }
  const location = (globalThis as { location?: Location }).location
  if (!location) throw new Error("openPayment needs a browser; pass options.open elsewhere")
  if (options.replace) location.replace(url)
  else location.assign(url)
}
