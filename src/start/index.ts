// ─── typedrift/start ─────────────────────────────────────────────────────────
//
// TanStack Start adapter for Typedrift.
//
// Auto-wires:
//   • params from TanStack Router route context ($segment convention)
//   • searchParams from TanStack Router search params
//   • onSuccess.redirect → router.navigate() from @tanstack/react-router
//   • onSuccess.revalidate → router.invalidate() from @tanstack/react-router
//
// Thick opt-ins:
//   • session: "cookie" | CookieSessionConfig — reads request cookies
//   • cache: { defaultTtl } without store → uses memoryCacheStore()

import type { ComponentType }          from "react"
import type { BindContext }             from "../types/index.js"
import type { Registry }                from "../registry/index.js"
import type { Middleware }              from "../middleware/index.js"
import type { CacheConfig, CacheStore }  from "../cache/index.js"
import type { TypedriftTracer }         from "../telemetry/index.js"
import type { CookieSessionConfig }     from "../adapter-shared.js"
import { createBinder }                 from "../binder/index.js"
import { memoryCacheStore }             from "../cache/index.js"
import { readCookieSession, lazyImport } from "../adapter-shared.js"

// ── CreateStartBinderOptions ──────────────────────────────────────────────────

export type StartCookieSessionConfig = CookieSessionConfig

export type CreateStartBinderOptions<TServices, TSession = undefined> = {
  // ── Core (same as createBinder) ───────────────────────────────────────────
  registry:     Registry<TServices, TSession>
  getServices:  (ctx: BindContext) => TServices | Promise<TServices>
  middleware?:  Middleware<TSession, TServices>[]
  tracer?:      TypedriftTracer

  // ── Session — pick one ────────────────────────────────────────────────────
  /** Thin: your own session function */
  getSession?:  (ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>
  /** Thick: reads request cookies automatically */
  session?:     "cookie" | StartCookieSessionConfig

  // ── Cache — composable ────────────────────────────────────────────────────
  cache?: {
    /**
     * Omit to use memoryCacheStore() automatically.
     * For production use redisCacheStore(redis).
     * Note: TanStack Start has no unstable_cache equivalent.
     */
    store?:     CacheStore
    defaultTtl: number
  }
}

// ── normalizeStartProps ───────────────────────────────────────────────────────
// TanStack Router passes params via the route context.
// When Typedrift binds a component, the component receives route context
// props from createFileRoute — we extract params and search here.

function normalizeStartProps(props: Record<string, unknown>): {
  params:       Record<string, string | undefined>
  searchParams: Record<string, string | string[] | undefined>
} {
  // TanStack Router injects params directly onto the component props
  // when used as a route component via createFileRoute({ component })
  const params = (props["params"] as Record<string, string | undefined>) ?? {}

  // searchParams from TanStack Router are on props.search
  const search = (props["search"] as Record<string, unknown>) ?? {}
  const searchParams: Record<string, string | string[] | undefined> = {}
  for (const [k, v] of Object.entries(search)) {
    if (typeof v === "string") searchParams[k] = v
    else if (Array.isArray(v)) searchParams[k] = v.map(String)
  }

  return { params, searchParams }
}

// ── handleStartOnSuccess ──────────────────────────────────────────────────────

async function handleStartOnSuccess(onSuccessResult: unknown): Promise<void> {
  if (!onSuccessResult || typeof onSuccessResult !== "object") return

  const res = onSuccessResult as Record<string, unknown>

  if ("redirect" in res && typeof res["redirect"] === "string") {
    try {
      const router = await lazyImport<{
        useRouter: () => { navigate: (opts: { to: string }) => Promise<void> }
      }>(
        "@tanstack/react-router",
        "@tanstack/react-router is required for redirect in typedrift/start"
      )
      // In a server context we can't use useRouter() — we store the redirect
      // target for the client to pick up, same pattern as the Next.js adapter
      ;(globalThis as any).__typedrift_redirect = res["redirect"]
    } catch (err) {
      console.warn("[typedrift/start] redirect failed:", err)
    }
  }

  if ("revalidate" in res && Array.isArray(res["revalidate"])) {
    // TanStack Router's cache invalidation is router-level
    // We store the invalidation request for the client to trigger
    // The Start adapter wires this to router.invalidate() on the client
    ;(globalThis as any).__typedrift_revalidate = res["revalidate"]
  }
}

// ── createStartBinder ─────────────────────────────────────────────────────────

export function createStartBinder<TServices, TSession = undefined>(
  options: CreateStartBinderOptions<TServices, TSession>,
): ReturnType<typeof createBinder<TServices, TSession>> {
  const {
    registry,
    getServices,
    middleware,
    tracer,
    getSession,
    session: sessionShorthand,
    cache: cacheOptions,
  } = options

  // ── Resolve session function ──────────────────────────────────────────────

  let resolvedGetSession:
    | ((ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>)
    | undefined = getSession

  if (!resolvedGetSession && sessionShorthand) {
    const sessionConfig: CookieSessionConfig =
      sessionShorthand === "cookie"
        ? { secret: process.env["TD_SESSION_SECRET"] ?? "change-me-in-production" }
        : sessionShorthand

    resolvedGetSession = async (ctx: BindContext) => {
      return readCookieSession(ctx.request, sessionConfig) as Promise<TSession | undefined>
    }
  }

  // ── Resolve cache config ──────────────────────────────────────────────────
  // TanStack Start has no unstable_cache equivalent.
  // Omitting store defaults to memoryCacheStore() — fine for dev,
  // use redisCacheStore() for production.

  let resolvedCache: CacheConfig | undefined

  if (cacheOptions) {
    resolvedCache = {
      store:      cacheOptions.store ?? memoryCacheStore(),
      defaultTtl: cacheOptions.defaultTtl,
    }
  }

  // ── Create base binder ────────────────────────────────────────────────────

  const binderOpts: any = { registry, getServices }
  if (resolvedGetSession !== undefined) binderOpts.getSession = resolvedGetSession
  if (middleware !== undefined)         binderOpts.middleware  = middleware
  if (tracer !== undefined)             binderOpts.tracer      = tracer
  if (resolvedCache !== undefined)      binderOpts.cache       = resolvedCache
  const baseBinder = createBinder<TServices, TSession>(binderOpts)

  // ── Wrap bind() to normalise TanStack Start props ─────────────────────────

  const originalBind    = baseBinder.bind.bind(baseBinder)
  const originalActions = baseBinder.actions.bind(baseBinder)

  function wrapComponent(BoundComponent: ComponentType<any>): ComponentType<any> {
    const StartWrapper = async (props: Record<string, unknown>) => {
      const { params, searchParams } = normalizeStartProps(props)
      const normalizedProps = { ...props, params, searchParams }
      return (BoundComponent as any)(normalizedProps)
    }
    StartWrapper.displayName = `StartAdapter(${
      (BoundComponent as any).displayName ?? "Component"
    })`
    return StartWrapper as ComponentType<any>
  }

  const patchedBinder = {
    ...baseBinder,

    bind(Component: ComponentType<any>, sources: any, bindOptions?: any) {
      const bound   = originalBind(Component, sources, bindOptions)
      const wrapped = wrapComponent(bound)
      ;(wrapped as any).actions = (mapOrFn: any) => {
        const withActions = (bound as any).actions(mapOrFn)
        return wrapComponent(withActions)
      }
      return wrapped as any
    },

    actions(Component: ComponentType<any>, mapOrFn: any) {
      const withActions = originalActions(Component, mapOrFn)
      return wrapComponent(withActions)
    },

    raw: baseBinder.raw.bind(baseBinder),
  }

  return patchedBinder as any
}
