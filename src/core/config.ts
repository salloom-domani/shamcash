import { ShamCashError } from "./errors.ts"
import { importSecretKey } from "./jwe.ts"
import {
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOKEN_TTL_SECONDS,
} from "./protocol.ts"

/** Minimal fetch signature, so Bun/Node/undici/polyfills all fit. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ShamCashConfig {
  /** Issued by ShamCash at service creation. */
  readonly agentKey: string
  /** Base64 AES-256 key issued by ShamCash. Server-side only. */
  readonly secretKey: string
  /** API root, e.g. the sandbox or production base URL from ShamCash. */
  readonly baseUrl: string
  /** Custom fetch (proxies, tests). Defaults to global `fetch`. */
  readonly fetch?: FetchLike | undefined
  /** Per-request timeout. Default 30s. */
  readonly timeoutMs?: number | undefined
  /** Lifetime of request tokens (`exp - iat`). Default 300s, as recommended. */
  readonly tokenTtlSeconds?: number | undefined
  /** Tolerance when checking webhook `iat`/`exp`. Default 60s. */
  readonly clockSkewSeconds?: number | undefined
  /** Clock override (ms). */
  readonly now?: (() => number) | undefined
  /** Skip the browser guard. Only for trusted environments (e.g. Electron main). */
  readonly dangerouslyAllowBrowser?: boolean | undefined
}

export interface Resolved {
  readonly agentKey: string
  readonly baseUrl: string
  readonly fetch: FetchLike
  readonly timeoutMs: number
  readonly tokenTtlSeconds: number
  readonly clockSkewSeconds: number
  readonly now: () => number
  readonly key: Promise<CryptoKey>
}

const cache = new WeakMap<ShamCashConfig, Resolved>()

export const assertServer = (allow: boolean | undefined): void => {
  if (allow) return
  const g = globalThis as { window?: unknown; document?: unknown }
  if (typeof g.window !== "undefined" && typeof g.document !== "undefined") {
    throw new ShamCashError(
      "validation",
      "shamcash must not run in the browser: it needs your secretKey. Use shamcash/client on the frontend.",
    )
  }
}

/** Validate config once and cache the imported key per config object. */
export const resolve = (config: ShamCashConfig): Resolved => {
  const hit = cache.get(config)
  if (hit) return hit
  assertServer(config.dangerouslyAllowBrowser)
  for (const field of ["agentKey", "secretKey", "baseUrl"] as const) {
    if (typeof config[field] !== "string" || config[field] === "") {
      throw new ShamCashError("validation", `config.${field} is required`)
    }
  }
  const key = importSecretKey(config.secretKey)
  // surface the failure on first use, not as an unhandled rejection
  key.catch(() => {})
  const resolved: Resolved = {
    agentKey: config.agentKey,
    baseUrl: config.baseUrl,
    fetch: config.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    tokenTtlSeconds: config.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
    clockSkewSeconds: config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
    now: config.now ?? Date.now,
    key,
  }
  cache.set(config, resolved)
  return resolved
}
