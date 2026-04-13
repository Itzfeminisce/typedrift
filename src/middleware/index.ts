// ─── Middleware — v0.5.0 ──────────────────────────────────────────────────────
//
// New in v0.5.0:
//   - MiddlewareFilter type — string | string[] | predicate function
//   - withFilter() — wrap any middleware with a filter
//   - auditMiddleware() — span-compatible audit log
//   - rateLimitMiddleware() — global rate limiting with pluggable store
//   - Built-in: middleware.requireAuth(), middleware.requireRole()

import type { BindContext } from "../types/index.js"
import { ForbiddenError, RateLimitError } from "../errors/index.js"

// ── Operation descriptor ──────────────────────────────────────────────────────

export type OperationDescriptor = {
  type:     "view" | "raw" | "action"
  model?:   string
  propKey:  string
  actionName?: string
}

// ── Middleware context ────────────────────────────────────────────────────────

export type MiddlewareContext<TSession, TServices> = {
  params:       Record<string, string | undefined>
  searchParams: Record<string, string | string[] | undefined>
  request?:     Request | undefined
  session:      TSession | undefined
  services:     TServices
  operation:    OperationDescriptor
}

export type Next = () => Promise<unknown>

export type Middleware<TSession = unknown, TServices = unknown> = (
  ctx:  MiddlewareContext<TSession, TServices>,
  next: Next,
) => Promise<unknown>

// ── MiddlewareFilter ──────────────────────────────────────────────────────────

export type MiddlewareFilter<TSession = unknown, TServices = unknown> =
  | "all"
  | "actions"
  | "views"
  | string[]
  | ((ctx: MiddlewareContext<TSession, TServices>) => boolean | Promise<boolean>)

// ── evalFilter — resolves filter to boolean ───────────────────────────────────

export async function evalFilter<TSession, TServices>(
  filter: MiddlewareFilter<TSession, TServices>,
  ctx:    MiddlewareContext<TSession, TServices>,
): Promise<boolean> {
  if (filter === "all")     return true
  if (filter === "actions") return ctx.operation.type === "action"
  if (filter === "views")   return ctx.operation.type === "view" || ctx.operation.type === "raw"
  if (Array.isArray(filter)) {
    // Match against operation type shorthand, action name, model name, or propKey
    return filter.some(f =>
      f === ctx.operation.type ||
      f === ctx.operation.actionName ||
      f === ctx.operation.model ||
      f === ctx.operation.propKey
    )
  }
  if (typeof filter === "function") {
    return filter(ctx)
  }
  return true
}

// ── withFilter — wrap any middleware with a filter ────────────────────────────

/**
 * Wrap any middleware with a filter so it only runs for matching operations.
 *
 * @example
 * const postLogger = withFilter(
 *   (ctx) => ctx.operation.model === "Post",
 *   async (ctx, next) => { console.log("[Post]", ctx.operation); return next() }
 * )
 */
export function withFilter<TSession, TServices>(
  filter: MiddlewareFilter<TSession, TServices>,
  mw:     Middleware<TSession, TServices>,
): Middleware<TSession, TServices> {
  return async (ctx, next) => {
    const shouldRun = await evalFilter(filter, ctx)
    if (!shouldRun) return next()
    return mw(ctx, next)
  }
}

// ── runMiddleware ─────────────────────────────────────────────────────────────

export function runMiddleware<TSession, TServices>(
  stack:   Middleware<TSession, TServices>[],
  ctx:     MiddlewareContext<TSession, TServices>,
  innerFn: () => Promise<unknown>,
): Promise<unknown> {
  if (stack.length === 0) return innerFn()
  const dispatch = (i: number): Promise<unknown> => {
    if (i === stack.length) return innerFn()
    return stack[i]!(ctx, () => dispatch(i + 1))
  }
  return dispatch(0)
}

// ── Built-in helpers ──────────────────────────────────────────────────────────

export const middleware = {
  requireAuth<TSession, TServices>(): Middleware<TSession, TServices> {
    return async (ctx, next) => {
      if (!ctx.session) throw new ForbiddenError("Not authenticated")
      return next()
    }
  },

  requireRole<TSession extends { role: string }, TServices>(
    allowedRoles: string[],
  ): Middleware<TSession, TServices> {
    return async (ctx, next) => {
      const session = ctx.session as TSession | undefined
      if (!session || !allowedRoles.includes(session.role)) {
        throw new ForbiddenError(
          `Role "${session?.role ?? "none"}" is not permitted. Required: ${allowedRoles.join(", ")}`
        )
      }
      return next()
    }
  },
}

// ── AuditEntry ────────────────────────────────────────────────────────────────

export type AuditEntry = {
  // Who
  userId:     string | null
  sessionId:  string | null
  ipAddress:  string | null
  // What
  operation:  string
  actionName: string | null
  model:      string | null
  input:      unknown
  result:     unknown
  // When + how long
  timestamp:  Date
  durationMs: number
  // Outcome
  success:    boolean
  errorCode:  string | null
  errorMsg:   string | null
}

// ── AuditMiddlewareOptions ────────────────────────────────────────────────────

export type AuditMiddlewareOptions<TSession, TServices> = {
  filter?:  MiddlewareFilter<TSession, TServices>
  redact?:  (entry: AuditEntry) => AuditEntry
  onEntry:  (entry: AuditEntry, ctx: MiddlewareContext<TSession, TServices>) => Promise<void>
}

/**
 * Audit log middleware. Records every matching operation with a
 * span-compatible entry shape — same entry can feed both a DB audit
 * table and an OTel tracing backend.
 *
 * @example
 * auditMiddleware({
 *   filter: "actions",
 *   redact: (entry) => ({ ...entry, input: redactFields(entry.input, ["password"]) }),
 *   onEntry: async (entry, ctx) => ctx.services.db.auditLog.create({ data: entry }),
 * })
 */
export function auditMiddleware<TSession, TServices>(
  options: AuditMiddlewareOptions<TSession, TServices>,
): Middleware<TSession, TServices> {
  const filter = options.filter ?? "actions"

  return withFilter(filter, async (ctx, next) => {
    const start = Date.now()
    let result:    unknown = undefined
    let success    = true
    let errorCode: string | null = null
    let errorMsg:  string | null = null

    try {
      result = await next()
      return result
    } catch (err: any) {
      success   = false
      errorCode = err?.code   ?? null
      errorMsg  = err?.message ?? null
      throw err
    } finally {
      const session = ctx.session as any

      let rawEntry: AuditEntry = {
        userId:     session?.userId    ?? session?.id ?? null,
        sessionId:  session?.sessionId ?? null,
        ipAddress:  ctx.request?.headers?.get?.("x-forwarded-for")
                 ?? ctx.request?.headers?.get?.("x-real-ip")
                 ?? null,
        operation:  `${ctx.operation.type}:${ctx.operation.actionName ?? ctx.operation.propKey}`,
        actionName: ctx.operation.actionName ?? null,
        model:      ctx.operation.model      ?? null,
        input:      (ctx as any).__actionInput ?? null,
        result:     success ? result : null,
        timestamp:  new Date(),
        durationMs: Date.now() - start,
        success,
        errorCode,
        errorMsg,
      }

      if (options.redact) {
        rawEntry = options.redact(rawEntry)
      }

      // Fire-and-forget — audit logging must never block the response
      options.onEntry(rawEntry, ctx).catch(err => {
        console.error("[typedrift] auditMiddleware onEntry failed:", err)
      })
    }
  })
}

// ── RateLimitStore ────────────────────────────────────────────────────────────

export type RateLimitStore = {
  /**
   * Increment the counter for key and return the new count.
   * Store must expire the key after windowMs if it does not already exist.
   */
  increment(key: string, windowMs: number): Promise<number>
}

// ── RateLimitMiddlewareOptions ────────────────────────────────────────────────

export type RateLimitMiddlewareOptions<TSession, TServices> = {
  filter?: MiddlewareFilter<TSession, TServices>
  store:   RateLimitStore
  window:  string   // "1m", "1h", "1d", "30s" etc.
  max:     number
  key:     (ctx: MiddlewareContext<TSession, TServices>) => string
}

function parseWindowMs(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/)
  if (!match) throw new Error(`[typedrift] Invalid rate limit window: "${window}". Use e.g. "30s", "1m", "1h", "1d".`)
  const value = parseInt(match[1]!, 10)
  const unit  = match[2]!
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return value * multipliers[unit]!
}

/**
 * Global rate limiting middleware. Runs before the resolver.
 * Throws RateLimitError when the limit is exceeded.
 *
 * @example
 * rateLimitMiddleware({
 *   filter: "actions",
 *   store:  redisRateLimitStore(redis),
 *   window: "1m",
 *   max:    100,
 *   key:    (ctx) => ctx.session?.userId ?? "anon",
 * })
 */
export function rateLimitMiddleware<TSession, TServices>(
  options: RateLimitMiddlewareOptions<TSession, TServices>,
): Middleware<TSession, TServices> {
  const filter    = options.filter ?? "all"
  const windowMs  = parseWindowMs(options.window)

  return withFilter(filter, async (ctx, next) => {
    const key   = options.key(ctx)
    const count = await options.store.increment(key, windowMs)

    if (count > options.max) {
      throw new RateLimitError(
        `Rate limit exceeded. Max ${options.max} requests per ${options.window}.`
      )
    }

    return next()
  })
}
