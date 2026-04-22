// ─── typedrift live types ─────────────────────────────────────────────────────

import type { BindContext } from "../types/index.js"

// ── CLEAR sentinel ────────────────────────────────────────────────────────────

/**
 * Return CLEAR from onData to explicitly reset the prop to null.
 * Returning null from onData keeps the previous value instead.
 *
 * @example
 * onData: (incoming, previous, meta) => {
 *   if (shouldReset) return CLEAR
 *   if (!meta.done)  return null   // keep previous mid-stream
 *   return JSON.parse(meta.accumulated)
 * }
 */
export const CLEAR = Symbol("typedrift.live.CLEAR")
export type  CLEAR = typeof CLEAR

// ── onData meta ───────────────────────────────────────────────────────────────

export type OnDataMeta = {
  /** True when the server signals stream completion */
  done:        boolean
  /** All raw SSE data concatenated since subscription started */
  accumulated: string
  /** Number of pushes received so far */
  pushCount:   number
}

// ── Reconnect config ──────────────────────────────────────────────────────────

export type ReconnectConfig = {
  /** Max reconnection attempts. Default: Infinity */
  attempts?: number
  /** Base delay in ms. Default: 1000 */
  delay?:    number
  /** Backoff strategy. Default: "exponential" */
  backoff?:  "exponential" | "linear" | "fixed"
  /** Max delay cap for exponential backoff in ms. Default: 30000 */
  maxDelay?: number
}

// ── LiveOptions ───────────────────────────────────────────────────────────────

export type LiveOptions<TInput, TData> = {
  // ── Core behaviour ────────────────────────────────────────────────────────

  /**
   * Poll fallback — re-fetch every N ms if no server push arrives.
   * Use for data changed by external systems with no action trigger.
   * Default: false (push-only)
   */
  interval?: number | false

  /**
   * Conditional subscription. When false or returning false,
   * behaves like a static view — no SSE connection opened.
   * Default: true
   */
  enabled?: boolean | ((ctx: BindContext) => boolean | Promise<boolean>)

  /**
   * Explicit subscription tags. The view listens for revalidation
   * of any of these tags and re-fetches when triggered.
   * Default: derived from the view's cache tag config
   */
  tags?: (input: TInput) => string[]

  /**
   * How long after SSE disconnect before stale: true is set (ms).
   * Prevents the stale banner flashing on brief reconnects.
   * Default: 0 (immediate)
   */
  staleTime?: number

  // ── Reconnection ─────────────────────────────────────────────────────────

  /**
   * Reconnection behaviour when SSE connection drops.
   * Default: { attempts: Infinity, delay: 1000, backoff: "exponential", maxDelay: 30000 }
   */
  reconnect?: boolean | ReconnectConfig

  // ── Data handling ─────────────────────────────────────────────────────────

  /**
   * Called on every incoming push before the component re-renders.
   * Return the transformed data, null to keep previous, or CLEAR to reset.
   *
   * Primary use case: AI streaming — accumulate tokens, parse progressively.
   *
   * @param incoming  The raw data from the server push
   * @param previous  The last successfully rendered value
   * @param meta      { done, accumulated, pushCount }
   */
  onData?: (
    incoming: TData,
    previous: TData | null,
    meta:     OnDataMeta,
  ) => TData | null | CLEAR | Promise<TData | null | CLEAR>

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Schema-agnostic validation on incoming push data.
   * Any object with .parse() — Zod, Valibot, Arktype etc.
   * Failed validation: keeps last valid data, sets error in useLiveData().
   */
  validate?: { parse: (data: unknown) => TData }

  // ── Temporal validity ─────────────────────────────────────────────────────

  /**
   * Max age of data in ms. Data older than this is marked stale
   * even if the SSE connection is healthy.
   * Use for: prices, inventory, availability — data with natural TTL.
   * Default: undefined (no expiry)
   */
  maxAge?: number

  /**
   * What to do when maxAge is exceeded.
   * Default: "stale"
   */
  onExpire?: "stale" | "refetch" | "clear"
}

// ── LiveState — returned by useLiveData() ─────────────────────────────────────

export type LiveState = {
  /** SSE connection dropped — showing last known value */
  stale:      boolean
  /** First load or reconnecting */
  loading:    boolean
  /** Set when validation fails or reconnection attempts exhausted */
  error:      import("../errors/index.js").StructuredError | null
  /** Timestamp of the last successful push */
  updatedAt:  Date | null
  /** Number of pushes received since mount */
  pushCount:  number
}

export const DEFAULT_LIVE_STATE: LiveState = {
  stale:     false,
  loading:   true,
  error:     null,
  updatedAt: null,
  pushCount: 0,
}

// ── LiveBoundViewDescriptor ───────────────────────────────────────────────────

export type LiveBoundViewDescriptor<TShape, TInput> = {
  readonly __type:    "live-bound-view"
  readonly options:   LiveOptions<TInput, TShape>
  /** The prop shape — identical to static view */
  readonly shape:     TShape
  /** Internal view descriptor used by the binder runtime. */
  readonly _view:     import("../view/index.js").ViewDescriptor<any, any>
  /** Internal input resolver used by the binder runtime. */
  readonly _from:     (ctx: BindContext) => TInput
  /** Internal nullability flag used by the binder runtime. */
  readonly _nullable: boolean
  /** Internal list flag used by the binder runtime. */
  readonly _isList:   boolean
  /** Stable live key used by useLiveData() lookups. */
  readonly _liveKey:  string
  /**
   * React hook — call inside the component to access live state.
   * Safe to call on static views — returns DEFAULT_LIVE_STATE.
   *
   * @example
   * const { stale, loading, updatedAt } = PostData.useLiveData()
   */
  useLiveData(): LiveState
}

// ── SSE push message shape ────────────────────────────────────────────────────

export type LivePushMessage = {
  /** Matches the prop key in bind() */
  key:     string
  /** The resolved data */
  data:    unknown
  /** True when stream is complete (AI streaming) */
  done?:   boolean
  /** Raw token for streaming accumulation */
  token?:  string
  /** Server error */
  error?:  { code: string; status: number; message: string }
}

// ── SSE subscription request ──────────────────────────────────────────────────

export type LiveSubscription = {
  /** Unique key for this source in bind() */
  key:       string
  /** Model name */
  model:     string
  /** Resolved input from .from() */
  input:     Record<string, unknown>
  /** Subscription tags */
  tags:      string[]
  /** Poll interval if set */
  interval?: number
}
