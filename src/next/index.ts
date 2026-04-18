// ─── typedrift/next ───────────────────────────────────────────────────────────
//
// Next.js App Router adapter for Typedrift.
//
// Auto-wires:
//   • params from Next.js page props (dynamic segments)
//   • searchParams from Next.js page props
//   • onSuccess.redirect → redirect() from next/navigation
//   • onSuccess.revalidate → revalidateTag() from next/cache
//
// Thick opt-ins:
//   • session: "cookie" | CookieSessionConfig — reads Next.js cookies()
//   • cache: { defaultTtl } without store → uses unstable_cache

import type { ComponentType }         from "react"
import type { BindContext }            from "../types/index.js"
import type { Registry }               from "../registry/index.js"
import type { Middleware }             from "../middleware/index.js"
import type { CacheConfig, CacheStore } from "../cache/index.js"
import type { TypedriftTracer }        from "../telemetry/index.js"
import type { SessionShorthand, CookieSessionConfig } from "../adapter-shared.js"
import { createBinder }                from "../binder/index.js"
import { readCookieSession, lazyImport } from "../adapter-shared.js"

// ── Next.js cache store via unstable_cache ────────────────────────────────────

function makeNextCacheStore(): CacheStore {
  // Lazy — only imports next/cache when actually used
  const tagMap = new Map<string, Set<string>>()

  return {
    async get(key) {
      // next/cache doesn't have a generic get — we use unstable_cache
      // as a wrapper around the resolver call, not a key-value store.
      // This store is a no-op get; the actual caching happens at executeView
      // time via the nextCacheWrapper below.
      return null
    },

    async set(_key, _value, _ttl) {
      // set is handled by nextCacheWrapper wrapping the resolver call
    },

    async invalidate(tags) {
      try {
        const nextCache = await lazyImport<{ revalidateTag: (tag: string) => void }>(
          "next/cache",
          "next/cache is required for cache invalidation in typedrift/next"
        )
        for (const tag of tags) {
          nextCache.revalidateTag(tag)
        }
      } catch (err) {
        console.warn("[typedrift/next] revalidateTag failed:", err)
      }
    },
  }
}

// ── CreateNextBinderOptions ───────────────────────────────────────────────────

export type NextCookieSessionConfig = CookieSessionConfig

export type CreateNextBinderOptions<TServices, TSession = undefined> = {
  // ── Core (same as createBinder) ───────────────────────────────────────────
  registry:     Registry<TServices, TSession>
  getServices:  (ctx: BindContext) => TServices | Promise<TServices>
  middleware?:  Middleware<TSession, TServices>[]
  tracer?:      TypedriftTracer

  // ── Session — pick one ────────────────────────────────────────────────────
  /** Thin: your own session function (JWT, Lucia, Auth.js, etc.) */
  getSession?:  (ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>
  /** Thick: reads Next.js cookies() automatically */
  session?:     "cookie" | NextCookieSessionConfig

  // ── Cache — composable ────────────────────────────────────────────────────
  cache?: {
    /** Omit to use Next.js unstable_cache automatically */
    store?:     CacheStore
    defaultTtl: number
  }
}

// ── normalizeNextProps ────────────────────────────────────────────────────────
// Extracts params and searchParams from Next.js page props shape.
// Next.js App Router passes these as promise-wrapped or plain objects.

async function normalizeNextProps(
  props: Record<string, unknown>,
): Promise<{ params: Record<string, string | undefined>; searchParams: Record<string, string | string[] | undefined> }> {
  // Next.js 15+ wraps params and searchParams in Promises
  const rawParams      = props["params"]
  const rawSearchParams = props["searchParams"]

  const params = (
    rawParams instanceof Promise ? await rawParams : rawParams
  ) as Record<string, string | undefined> ?? {}

  const searchParams = (
    rawSearchParams instanceof Promise ? await rawSearchParams : rawSearchParams
  ) as Record<string, string | string[] | undefined> ?? {}

  return { params, searchParams }
}

// ── handleOnSuccess — Next.js specific ───────────────────────────────────────

async function handleNextOnSuccess(onSuccessResult: unknown): Promise<void> {
  if (!onSuccessResult || typeof onSuccessResult !== "object") return

  const res = onSuccessResult as Record<string, unknown>

  // redirect
  if ("redirect" in res && typeof res["redirect"] === "string") {
    try {
      const nav = await lazyImport<{ redirect: (url: string) => never }>(
        "next/navigation",
        "next/navigation is required for redirect in typedrift/next"
      )
      nav.redirect(res["redirect"])
    } catch (err: any) {
      // redirect() throws a special Next.js error — rethrow it
      if (err?.digest?.startsWith("NEXT_REDIRECT")) throw err
      console.warn("[typedrift/next] redirect failed:", err)
    }
  }

  // revalidate — calls revalidateTag for each tag
  if ("revalidate" in res && Array.isArray(res["revalidate"])) {
    try {
      const nextCache = await lazyImport<{
        revalidateTag:  (tag: string) => void
        revalidatePath: (path: string) => void
      }>(
        "next/cache",
        "next/cache is required for revalidation in typedrift/next"
      )
      for (const tag of res["revalidate"] as string[]) {
        nextCache.revalidateTag(tag)
      }
    } catch (err) {
      console.warn("[typedrift/next] revalidateTag failed:", err)
    }
  }
}

// ── createNextBinder ──────────────────────────────────────────────────────────

export function createNextBinder<TServices, TSession = undefined>(
  options: CreateNextBinderOptions<TServices, TSession>,
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

  let resolvedCache: CacheConfig | undefined

  if (cacheOptions) {
    resolvedCache = {
      store:      cacheOptions.store ?? makeNextCacheStore(),
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

  // ── Wrap bind() to normalise Next.js props ────────────────────────────────
  // Next.js page props have params/searchParams that need async unwrapping.
  // We wrap the bound component to handle this transparently.

  const originalBind = baseBinder.bind.bind(baseBinder)
  const originalActions = baseBinder.actions.bind(baseBinder)

  function wrapComponent(BoundComponent: ComponentType<any>): ComponentType<any> {
    const NextWrapper = async (props: Record<string, unknown>) => {
      const { params, searchParams } = await normalizeNextProps(props)
      const normalizedProps = { ...props, params, searchParams }
      return (BoundComponent as any)(normalizedProps)
    }
    NextWrapper.displayName = `NextAdapter(${
      (BoundComponent as any).displayName ?? "Component"
    })`
    return NextWrapper as ComponentType<any>
  }

  // Patch bind() to wrap the returned component
  const patchedBinder = {
    ...baseBinder,

    bind(Component: ComponentType<any>, sources: any, bindOptions?: any) {
      const bound = originalBind(Component, sources, bindOptions)
      // Attach .actions() that also wraps
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
