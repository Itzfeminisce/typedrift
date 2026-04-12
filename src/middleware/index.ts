// ─── Middleware ───────────────────────────────────────────────────────────────
//
// Middleware runs once per source in a bind() call — each bound view and
// raw source gets its own middleware pass. This gives granular observability.
//
// Execution order per source:
//   getServices → getSession → [middleware[0] → middleware[1] → ...] → resolver

import type { BindContext } from "../types/index.js"
import { ForbiddenError } from "../errors/index.js"

// ── Operation descriptor ──────────────────────────────────────────────────────

export type OperationDescriptor = {
  /** "view" for bound views, "raw" for raw() sources */
  type:     "view" | "raw"
  /** Model name — set for view operations, undefined for raw */
  model?:   string
  /** The prop key this source is bound to in bind() */
  propKey:  string
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

// ── Middleware function type ───────────────────────────────────────────────────

export type Next = () => Promise<unknown>

export type Middleware<TSession = unknown, TServices = unknown> = (
  ctx:  MiddlewareContext<TSession, TServices>,
  next: Next,
) => Promise<unknown>

// ── Middleware runner ─────────────────────────────────────────────────────────

/**
 * Compose a middleware stack into a single function.
 * Middleware runs in array order — first middleware is outermost.
 */
export function runMiddleware<TSession, TServices>(
  stack:     Middleware<TSession, TServices>[],
  ctx:       MiddlewareContext<TSession, TServices>,
  innerFn:   () => Promise<unknown>,
): Promise<unknown> {
  if (stack.length === 0) return innerFn()

  const dispatch = (index: number): Promise<unknown> => {
    if (index === stack.length) return innerFn()
    const mw = stack[index]!
    return mw(ctx, () => dispatch(index + 1))
  }

  return dispatch(0)
}

// ── Built-in middleware helpers ───────────────────────────────────────────────

export const middleware = {
  /**
   * Throws ForbiddenError if session is absent.
   * Place first in the middleware array so all subsequent middleware
   * and resolvers can safely assume ctx.session is defined.
   *
   * @example
   * middleware: [middleware.requireAuth(), loggingMiddleware]
   */
  requireAuth<TSession, TServices>(): Middleware<TSession, TServices> {
    return async (ctx, next) => {
      if (!ctx.session) {
        throw new ForbiddenError("Not authenticated")
      }
      return next()
    }
  },

  /**
   * Throws ForbiddenError if session.role is not in the allowed list.
   * Assumes session has a `role` field.
   *
   * @example
   * middleware.requireRole(["admin", "editor"])
   */
  requireRole<TSession extends { role: string }, TServices>(
    allowedRoles: string[],
  ): Middleware<TSession, TServices> {
    return async (ctx, next) => {
      const session = ctx.session as TSession | undefined
      if (!session || !allowedRoles.includes(session.role)) {
        throw new ForbiddenError(
          `Role "${session?.role ?? "none"}" is not permitted. ` +
          `Required: ${allowedRoles.join(", ")}`
        )
      }
      return next()
    }
  },
}
