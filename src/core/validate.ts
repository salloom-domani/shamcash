import { ShamCashError } from "./errors.ts"
import type { Amount } from "./types.ts"

const fail = (message: string): never => {
  throw new ShamCashError("validation", message)
}

export const nonEmpty = (field: string, value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} must be a non-empty string`)
  return value as string
}

export const optionalString = (field: string, value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string") fail(`${field} must be a string`)
  return value as string
}

const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/

/** Positive decimal with ≤ 2 fraction digits, ≥ 0.01. Returned as a JSON number. */
export const amount = (field: string, value: Amount): number => {
  const str = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value
  if (typeof str !== "string" || !AMOUNT.test(str.trim())) {
    fail(`${field} must be a positive decimal with at most 2 fraction digits`)
  }
  const n = Number(str)
  if (n < 0.01) fail(`${field} must be at least 0.01`)
  return n
}

export const httpUrl = (field: string, value: unknown): string => {
  const str = nonEmpty(field, value)
  if (str.length > 500) fail(`${field} must be at most 500 characters`)
  let url: URL
  try {
    url = new URL(str)
  } catch {
    return fail(`${field} must be an absolute URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail(`${field} must be http(s)`)
  return str
}

export const idempotencyKey = (value: unknown): string => {
  const str = nonEmpty("idempotencyKey", value)
  if (str.length < 10 || str.length > 100) fail("idempotencyKey must be 10–100 characters")
  return str
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const optionalDate = (field: string, value: unknown): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !DATE.test(value)) fail(`${field} must be yyyy-MM-dd`)
  return value as string
}

export const intInRange = (field: string, value: unknown, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer between ${min} and ${max}`)
  }
  return value as number
}
