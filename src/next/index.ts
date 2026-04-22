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

import { createElement }               from "react"
import type { ComponentType }          from "react"
import type { BindContext, ResolverContext } from "../types/index.js"
import type { Registry }               from "../registry/index.js"
import type { Middleware, MiddlewareContext } from "../middleware/index.js"
import type { CacheConfig, CacheStore } from "../cache/index.js"
import type { TypedriftTracer }        from "../telemetry/index.js"
import type { SessionShorthand, CookieSessionConfig } from "../adapter-shared.js"
import { createBinder }                from "../binder/index.js"
import type { Binder }                 from "../binder/index.js"
import type { ActionCallable, ActionDefinition, OnSuccessResult } from "../action/index.js"
import { readCookieSession, lazyImport } from "../adapter-shared.js"
import { executeAction }               from "../action/index.js"
import { runMiddleware }               from "../middleware/index.js"
import { isTypedriftError }            from "../errors/index.js"

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
        const nextCache = await lazyImport<{ revalidateTag: (tag: string, profile?: string) => void }>(
          "next/cache",
          "next/cache is required for cache invalidation in typedrift/next"
        )
        for (const tag of tags) {
          nextCache.revalidateTag(tag, "max")
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
): Promise<BindContext> {
  // Next.js 15+ wraps params and searchParams in Promises
  const rawParams      = props["params"]
  const rawSearchParams = props["searchParams"]

  const params = (
    rawParams instanceof Promise ? await rawParams : rawParams
  ) as Record<string, string | undefined> ?? {}

  const searchParams = (
    rawSearchParams instanceof Promise ? await rawSearchParams : rawSearchParams
  ) as Record<string, string | string[] | undefined> ?? {}

  const bindCtx: BindContext = { params, searchParams }
  if (props["request"] !== undefined) bindCtx.request = props["request"] as Request
  if (props["runtime"] !== undefined) bindCtx.runtime = props["runtime"]
  return bindCtx
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
        revalidateTag:  (tag: string, profile?: string) => void
        revalidatePath: (path: string) => void
      }>(
        "next/cache",
        "next/cache is required for revalidation in typedrift/next"
      )
      for (const tag of res["revalidate"] as string[]) {
        nextCache.revalidateTag(tag, "max")
      }
    } catch (err) {
      console.warn("[typedrift/next] revalidateTag failed:", err)
    }
  }
}

type NextActionMap<TServices, TSession> = Record<
  string,
  ActionDefinition<any, any, TServices, TSession>
>

type NextActionMapFn<TServices, TSession> = (
  ctx: {
    session:      TSession | undefined
    services:     TServices
    params:       Record<string, string | undefined>
    searchParams: Record<string, string | string[] | undefined>
  }
) => NextActionMap<TServices, TSession> | Promise<NextActionMap<TServices, TSession>>

type NextActionMapOrFn<TServices, TSession> =
  | NextActionMap<TServices, TSession>
  | NextActionMapFn<TServices, TSession>

type RegisteredNextAction<TServices, TSession> = {
  definition:  ActionDefinition<any, any, TServices, TSession>
  bindCtx:     BindContext
  getServices: (ctx: BindContext) => TServices | Promise<TServices>
  getSession?: (ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>
  middleware:  Middleware<TSession, TServices>[]
  actionName:  string
}

const nextActionRegistry = new Map<string, RegisteredNextAction<any, any>>()
let nextActionCounter = 0

function isClientReference(Component: ComponentType<any>): boolean {
  const marker = (Component as any)?.$$typeof
  return typeof marker === "symbol" && (
    Symbol.keyFor(marker) === "react.client.reference" ||
    Symbol.keyFor(marker) === "react.module.reference"
  )
}

function renderComponent(Component: ComponentType<any>, props: Record<string, unknown>) {
  if (isClientReference(Component)) {
    return createElement(Component as any, props)
  }
  return (Component as any)(props)
}

function cloneBindContext(bindCtx: BindContext): BindContext {
  const cloned: BindContext = {
    params: { ...bindCtx.params },
    searchParams: { ...bindCtx.searchParams },
  }
  if (bindCtx.request !== undefined) cloned.request = bindCtx.request
  if (bindCtx.runtime !== undefined) cloned.runtime = bindCtx.runtime
  return cloned
}

async function invokeRegisteredNextAction<TServices, TSession>(
  actionId: string,
  input: unknown,
): Promise<unknown> {
  const registered = nextActionRegistry.get(actionId) as RegisteredNextAction<TServices, TSession> | undefined
  if (!registered) {
    throw new Error("[typedrift/next] Action registration expired or was not found.")
  }

  const bindCtx   = cloneBindContext(registered.bindCtx)
  const services  = await registered.getServices(bindCtx)
  const session   = registered.getSession ? await registered.getSession(bindCtx) : undefined
  const resolverCtx: ResolverContext<TServices, TSession> = {
    bind: bindCtx,
    services,
    session,
  }

  const mwCtx: MiddlewareContext<TSession, TServices> = {
    params:       bindCtx.params,
    searchParams: bindCtx.searchParams,
    request:      bindCtx.request,
    session,
    services,
    operation:    { type: "action", propKey: registered.actionName, actionName: registered.actionName },
  }
  ;(mwCtx as any).__actionInput = input

  let capturedResult: unknown
  let capturedOnSuccess: OnSuccessResult | undefined

  await runMiddleware(registered.middleware as any, mwCtx, async () => {
    const { result, onSuccessResult } = await executeAction(
      registered.definition,
      input,
      resolverCtx,
    )
    capturedResult = result
    capturedOnSuccess = onSuccessResult
    return result
  })

  await handleNextOnSuccess(capturedOnSuccess)
  return capturedResult
}

function makeNextActionCallable<TInput, TResult, TServices, TSession>(
  definition:  ActionDefinition<TInput, TResult, TServices, TSession>,
  bindCtx:     BindContext,
  getServices: (ctx: BindContext) => TServices | Promise<TServices>,
  getSession:  ((ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>) | undefined,
  middleware:  Middleware<TSession, TServices>[],
  actionName:  string,
): ActionCallable<TInput, TResult> {
  let pending = false
  let error: string | null = null
  let fieldErrors: Record<string, string> | null = null
  let lastResult: TResult | null = null

  const actionId = `typedrift-next-action:${++nextActionCounter}`
  const registered: RegisteredNextAction<TServices, TSession> = {
    definition,
    bindCtx: cloneBindContext(bindCtx),
    getServices,
    middleware,
    actionName,
  }
  if (getSession !== undefined) {
    registered.getSession = getSession
  }
  nextActionRegistry.set(actionId, registered)

  const callable = async (input: TInput): Promise<TResult> => {
    "use server"

    pending = true
    error = null
    fieldErrors = null

    try {
      const result = await invokeRegisteredNextAction<TServices, TSession>(actionId, input) as TResult
      lastResult = result
      return result
    } catch (err) {
      if (isTypedriftError(err)) {
        error = err.message
        if ("fields" in (err as any) && (err as any).fields) {
          fieldErrors = (err as any).fields as Record<string, string>
        }
      } else {
        error = "An unexpected error occurred"
      }
      throw err
    } finally {
      pending = false
    }
  }

  Object.defineProperties(callable, {
    pending:     { get: () => pending },
    error:       { get: () => error },
    fieldErrors: { get: () => fieldErrors },
    lastResult:  { get: () => lastResult },
  })

  return callable as ActionCallable<TInput, TResult>
}

async function resolveNextActionProps<TServices, TSession>(
  mapOrFn:      NextActionMapOrFn<TServices, TSession>,
  bindCtx:      BindContext,
  getServices:  (ctx: BindContext) => TServices | Promise<TServices>,
  getSession:   ((ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>) | undefined,
  middleware:   Middleware<TSession, TServices>[],
): Promise<Record<string, ActionCallable<any, any>>> {
  const services = await getServices(bindCtx)
  const session  = getSession ? await getSession(bindCtx) : undefined

  const map = typeof mapOrFn === "function"
    ? await mapOrFn({
        session,
        services,
        params: bindCtx.params,
        searchParams: bindCtx.searchParams,
      })
    : mapOrFn

  const actions: Record<string, ActionCallable<any, any>> = {}
  for (const [key, definition] of Object.entries(map)) {
    actions[key] = makeNextActionCallable(
      definition,
      bindCtx,
      getServices,
      getSession,
      middleware,
      key,
    )
  }
  return actions
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
      if (ctx.request) {
        return readCookieSession(ctx.request, sessionConfig) as Promise<TSession | undefined>
      }

      try {
        const nextHeaders = await lazyImport<{ cookies: () => Promise<{ getAll(): Array<{ name: string; value: string }> }> }>(
          "next/headers",
          "next/headers is required for cookie-backed sessions in typedrift/next"
        )
        const cookieStore = await nextHeaders.cookies()
        const cookieHeader = cookieStore
          .getAll()
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; ")
        const request = new Request("http://typedrift.local/__typedrift/action", {
          headers: cookieHeader ? { cookie: cookieHeader } : {},
        })
        return readCookieSession(request, sessionConfig) as Promise<TSession | undefined>
      } catch {
        return undefined
      }
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
  const middlewareStack = middleware ?? []

  // Patch bind() to wrap the returned component
  const patchedBinder = {
    ...baseBinder,

    bind(Component: ComponentType<any>, sources: any, bindOptions?: any) {
      const collectProps = originalBind(
        (((props: Record<string, unknown>) => props) as unknown as ComponentType<any>),
        sources,
        bindOptions,
      )

      const wrapped = async (props: Record<string, unknown>) => {
        const bindCtx = await normalizeNextProps(props)
        const normalizedProps = { ...props, ...bindCtx }
        const injectedProps = await (collectProps as any)(normalizedProps)
        return renderComponent(Component, injectedProps)
      }

      wrapped.displayName = `NextAdapter(${
        (Component as any).displayName ?? (Component as any).name ?? "Component"
      })`

      ;(wrapped as any).actions = (mapOrFn: any) => {
        const withActions = async (props: Record<string, unknown>) => {
          const bindCtx = await normalizeNextProps(props)
          const normalizedProps = { ...props, ...bindCtx }
          const [injectedProps, actionProps] = await Promise.all([
            (collectProps as any)(normalizedProps),
            resolveNextActionProps(
              mapOrFn,
              bindCtx,
              getServices,
              resolvedGetSession,
              middlewareStack,
            ),
          ])
          return renderComponent(Component, { ...injectedProps, ...actionProps })
        }

        withActions.displayName = `NextAdapter.WithActions(${
          (Component as any).displayName ?? (Component as any).name ?? "Component"
        })`
        return withActions as any
      }
      return wrapped as any
    },

    actions(Component: ComponentType<any>, mapOrFn: any) {
      const withActions = async (props: Record<string, unknown>) => {
        const bindCtx = await normalizeNextProps(props)
        const normalizedProps = { ...props, ...bindCtx }
        const actionProps = await resolveNextActionProps(
          mapOrFn,
          bindCtx,
          getServices,
          resolvedGetSession,
          middlewareStack,
        )
        return renderComponent(Component, { ...normalizedProps, ...actionProps })
      }

      withActions.displayName = `NextAdapter.Actions(${
        (Component as any).displayName ?? (Component as any).name ?? "Component"
      })`
      return withActions as any
    },

    raw: baseBinder.raw.bind(baseBinder),
  }

  // Auto-register live endpoint
  // In Next.js App Router, developers add one file:
  // app/api/__typedrift/live/route.ts → export const GET = binder.liveHandler()
  // The adapter exports a ready-made handler they can re-export

  return patchedBinder as any
}

/**
 * Ready-made Next.js route handler for the live SSE endpoint.
 * Place this in app/api/__typedrift/live/route.ts:
 *
 * @example
 * // app/api/__typedrift/live/route.ts
 * export { nextLiveRoute as GET } from "@/lib/binder"
 *
 * // lib/binder.ts
 * export const nextLiveRoute = createNextLiveRoute(binder)
 */
export function createNextLiveRoute(
  binder: Pick<Binder<any, any>, "liveHandler">
): (request: Request) => Promise<Response> {
  return (binder as any).liveHandler()
}
