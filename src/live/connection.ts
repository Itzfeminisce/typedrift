// ─── SSE connection manager ───────────────────────────────────────────────────
//
// Manages one SSE connection per page, multiplexed across multiple live sources.
// Handles reconnection with configurable backoff.
// Client-side only — runs in the browser.

import type {
  LivePushMessage,
  LiveSubscription,
  LiveState,
  ReconnectConfig,
} from "./types.js"
import { DEFAULT_LIVE_STATE } from "./types.js"

// ── Reconnect backoff ─────────────────────────────────────────────────────────

function computeDelay(
  attempt: number,
  config:  Required<ReconnectConfig>,
): number {
  let delay: number
  switch (config.backoff) {
    case "exponential":
      delay = config.delay * Math.pow(2, attempt - 1)
      break
    case "linear":
      delay = config.delay * attempt
      break
    case "fixed":
    default:
      delay = config.delay
  }
  return Math.min(delay, config.maxDelay)
}

const DEFAULT_RECONNECT: Required<ReconnectConfig> = {
  attempts: Infinity,
  delay:    1000,
  backoff:  "exponential",
  maxDelay: 30_000,
}

// ── LiveConnection ────────────────────────────────────────────────────────────

type PushCallback  = (msg: LivePushMessage) => void
type StateCallback = (key: string, state: Partial<LiveState>) => void

export class LiveConnection {
  private endpoint:     string
  private subs:         Map<string, LiveSubscription> = new Map()
  private callbacks:    Map<string, PushCallback>     = new Map()
  private onStateChange: StateCallback
  private es:           EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt:      number = 0
  private closed:       boolean = false
  private reconnectCfg: Required<ReconnectConfig>
  private staleTimers:  Map<string, ReturnType<typeof setTimeout>> = new Map()
  private staleTime:    number

  constructor(opts: {
    endpoint:      string
    onStateChange: StateCallback
    reconnect?:    boolean | ReconnectConfig
    staleTime?:    number
  }) {
    this.endpoint      = opts.endpoint
    this.onStateChange = opts.onStateChange
    this.staleTime     = opts.staleTime ?? 0

    const rc = opts.reconnect
    if (rc === false) {
      // No reconnect — set attempts to 0
      this.reconnectCfg = { ...DEFAULT_RECONNECT, attempts: 0 }
    } else if (rc === true || rc === undefined) {
      this.reconnectCfg = DEFAULT_RECONNECT
    } else {
      this.reconnectCfg = { ...DEFAULT_RECONNECT, ...rc }
    }
  }

  // ── Subscribe ───────────────────────────────────────────────────────────────

  subscribe(
    sub:      LiveSubscription,
    callback: PushCallback,
  ): () => void {
    this.subs.set(sub.key, sub)
    this.callbacks.set(sub.key, callback)

    // Open/reopen connection with updated subscriptions
    this.connect()

    // Return unsubscribe
    return () => {
      this.subs.delete(sub.key)
      this.callbacks.delete(sub.key)
      if (this.subs.size === 0) this.disconnect()
      else this.connect() // reconnect with updated sub list
    }
  }

  // ── Connect ─────────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.closed) return

    // Close existing connection
    if (this.es) {
      this.es.close()
      this.es = null
    }

    if (this.subs.size === 0) return

    // Build URL with subscription params
    const url = this.buildUrl()

    this.es = new EventSource(url)

    this.es.onopen = () => {
      this.attempt = 0
      // Mark all subs as connected (loading: false)
      for (const key of this.subs.keys()) {
        this.clearStaleTimer(key)
        this.onStateChange(key, { loading: false, stale: false, error: null })
      }
    }

    this.es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as LivePushMessage
        const cb  = this.callbacks.get(msg.key)
        if (cb) cb(msg)
      } catch {
        // Malformed push — ignore
      }
    }

    this.es.onerror = () => {
      this.es?.close()
      this.es = null

      // Start stale timers for all subs
      for (const key of this.subs.keys()) {
        this.startStaleTimer(key)
      }

      this.scheduleReconnect()
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────

  disconnect(): void {
    this.closed = true
    this.es?.close()
    this.es = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    for (const key of this.staleTimers.keys()) this.clearStaleTimer(key)
  }

  // ── Reconnect scheduling ──────────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.attempt++

    if (this.attempt > this.reconnectCfg.attempts) {
      // Max attempts exceeded
      for (const key of this.subs.keys()) {
        this.onStateChange(key, {
          stale: true,
          loading: false,
          error: {
            code:    "INTERNAL",
            status:  503,
            message: `Live connection failed after ${this.reconnectCfg.attempts} attempts`,
          },
        })
      }
      return
    }

    const delay = computeDelay(this.attempt, this.reconnectCfg)

    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) {
        for (const key of this.subs.keys()) {
          this.onStateChange(key, { loading: true })
        }
        this.connect()
      }
    }, delay)
  }

  // ── Stale timers ─────────────────────────────────────────────────────────────

  private startStaleTimer(key: string): void {
    if (this.staleTimers.has(key)) return
    const timer = setTimeout(() => {
      this.onStateChange(key, { stale: true })
      this.staleTimers.delete(key)
    }, this.staleTime)
    this.staleTimers.set(key, timer)
  }

  private clearStaleTimer(key: string): void {
    const timer = this.staleTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.staleTimers.delete(key)
    }
  }

  // ── URL builder ───────────────────────────────────────────────────────────────

  private buildUrl(): string {
    const subs = [...this.subs.values()]
    const params = new URLSearchParams()
    params.set("subs", JSON.stringify(subs))
    return `${this.endpoint}?${params.toString()}`
  }

  // ── Manual refetch ────────────────────────────────────────────────────────────

  refetch(key: string): void {
    // Trigger a one-shot fetch for this key by closing and reopening
    // The server will push fresh data on connect
    this.connect()
  }
}
