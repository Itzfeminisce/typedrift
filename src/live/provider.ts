// ─── LiveProvider and useLiveData hook ───────────────────────────────────────
// Note: JSX is avoided here to keep this file .ts compatible.
// The binder injects LiveContext — components call view.useLiveData().

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  createElement,
  type ReactNode,
} from "react"
import type { LiveState, OnDataMeta, LiveOptions } from "./types.js"
import { DEFAULT_LIVE_STATE, CLEAR } from "./types.js"
import { LiveConnection } from "./connection.js"
import type { ReconnectConfig } from "./types.js"

// ── LiveContext ───────────────────────────────────────────────────────────────

export type LiveContextValue = {
  getState:  (key: string) => LiveState
  subscribe: (key: string, listener: () => void) => () => void
}

export const LiveContext = createContext<LiveContextValue | null>(null)

// ── useLiveDataForKey ─────────────────────────────────────────────────────────

export function useLiveDataForKey(key: string): LiveState {
  const ctx = useContext(LiveContext)
  if (!ctx) return DEFAULT_LIVE_STATE

  const [state, setState] = useState(() => ctx.getState(key))

  useEffect(() => {
    const unsub = ctx.subscribe(key, () => setState(ctx.getState(key)))
    return unsub
  }, [ctx, key])

  return state
}

// ── LiveSourceConfig ──────────────────────────────────────────────────────────

export type LiveSourceConfig<TData = unknown> = {
  key:      string
  model:    string
  input:    Record<string, unknown>
  tags:     string[]
  options:  LiveOptions<Record<string, unknown>, TData>
  onUpdate: (data: TData | null) => void
}

export type LiveProviderProps = {
  endpoint: string
  sources:  LiveSourceConfig[]
  children: ReactNode
}

// ── LiveProvider ──────────────────────────────────────────────────────────────

export function LiveProvider({ endpoint, sources, children }: LiveProviderProps) {
  const [states, setStates] = useState<Map<string, LiveState>>(() => {
    const m = new Map<string, LiveState>()
    for (const src of sources) m.set(src.key, { ...DEFAULT_LIVE_STATE })
    return m
  })

  const accumulated  = useRef(new Map<string, string>())
  const pushCounts   = useRef(new Map<string, number>())
  const prevData     = useRef(new Map<string, unknown>())
  const listeners    = useRef(new Map<string, Set<() => void>>())
  const connectionRef = useRef<LiveConnection | null>(null)

  const notifyListeners = useCallback((key: string) => {
    listeners.current.get(key)?.forEach(fn => fn())
  }, [])

  const updateState = useCallback((key: string, patch: Partial<LiveState>) => {
    setStates(prev => {
      const next = new Map(prev)
      const cur  = next.get(key) ?? { ...DEFAULT_LIVE_STATE }
      next.set(key, { ...cur, ...patch })
      return next
    })
    notifyListeners(key)
  }, [notifyListeners])

  useEffect(() => {
    const staleTime = sources.reduce((min, s) => Math.min(min, s.options.staleTime ?? 0), 0)
    const reconnect = sources[0]?.options.reconnect

    const conn = new LiveConnection({
      endpoint,
      onStateChange: updateState,
      ...(staleTime > 0          ? { staleTime }  : {}),
      ...(reconnect !== undefined ? { reconnect: reconnect as boolean | ReconnectConfig } : {}),
    })
    connectionRef.current = conn

    const unsubs: (() => void)[] = []

    for (const src of sources) {
      const interval = typeof src.options.interval === "number"
        ? src.options.interval : undefined

      const subOpts = {
        key:   src.key,
        model: src.model,
        input: src.input,
        tags:  src.tags,
        ...(interval !== undefined ? { interval } : {}),
      }

      const unsub = conn.subscribe(subOpts as any, async (msg: any) => {
        if (msg.error) {
          updateState(src.key, { error: msg.error as any, loading: false })
          return
        }

        const token = msg.token ?? ""
        const prev  = accumulated.current.get(src.key) ?? ""
        accumulated.current.set(src.key, prev + token)
        const count = (pushCounts.current.get(src.key) ?? 0) + 1
        pushCounts.current.set(src.key, count)

        const meta: OnDataMeta = {
          done:        msg.done ?? false,
          accumulated: accumulated.current.get(src.key) ?? "",
          pushCount:   count,
        }

        let data: unknown = msg.data

        if (src.options.onData) {
          const prevVal = prevData.current.get(src.key) ?? null
          const result  = await src.options.onData(msg.data as any, prevVal as any, meta)
          if (result === CLEAR) {
            data = null
            prevData.current.delete(src.key)
          } else if (result === null) {
            updateState(src.key, { updatedAt: new Date(), pushCount: count })
            return
          } else {
            data = result
          }
        }

        if (src.options.validate && data !== null) {
          try {
            data = src.options.validate.parse(data)
          } catch (err: any) {
            updateState(src.key, {
              error: { code: "VALIDATION_FAILED", status: 422, message: err?.message ?? "Validation failed" },
            })
            return
          }
        }

        if (src.options.maxAge) {
          setTimeout(() => {
            const action = src.options.onExpire ?? "stale"
            if (action === "stale")   updateState(src.key, { stale: true })
            else if (action === "clear") { src.onUpdate(null); updateState(src.key, { stale: true }) }
            else if (action === "refetch") connectionRef.current?.refetch(src.key)
          }, src.options.maxAge)
        }

        prevData.current.set(src.key, data)
        src.onUpdate(data as any)
        updateState(src.key, { loading: false, stale: false, error: null, updatedAt: new Date(), pushCount: count })
      })

      unsubs.push(unsub)
    }

    return () => {
      unsubs.forEach(fn => fn())
      conn.disconnect()
      connectionRef.current = null
    }
  }, [endpoint, sources, updateState])

  const ctxValue: LiveContextValue = {
    getState:  (key) => states.get(key) ?? DEFAULT_LIVE_STATE,
    subscribe: (key, listener) => {
      if (!listeners.current.has(key)) listeners.current.set(key, new Set())
      listeners.current.get(key)!.add(listener)
      return () => listeners.current.get(key)?.delete(listener)
    },
  }

  return createElement(
    LiveContext.Provider,
    { value: ctxValue },
    children,
  )
}
