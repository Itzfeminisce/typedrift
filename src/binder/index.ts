// ─── Binder — v0.4.0 ─────────────────────────────────────────────────────────
//
// New in v0.4.0:
//   - binder.actions() — standalone action injector
//   - binder.bind().actions() — chainable from bind()
//   - actions() accepts static map OR (ctx) => map function
//   - ActionCallable injected as typed prop
//   - Conditional actions typed as T | undefined

import type { ComponentType }                      from "react"
import type { BindContext, RawContext }             from "../types/index.js"
import type { Registry }                           from "../registry/index.js"
import type { BoundViewDescriptor, ViewDescriptor } from "../view/index.js"
import type { AnyModelDescriptor, AnyFieldDescriptor } from "../field/index.js"
import type { Middleware, MiddlewareContext }       from "../middleware/index.js"
import type { StructuredError }                    from "../errors/index.js"
import type {
  ActionDefinition,
  ActionCallable,
  OnSuccessResult,
}                                                  from "../action/index.js"
import { runMiddleware }                           from "../middleware/index.js"
import { isTypedriftError }                        from "../errors/index.js"
import { executeAction }                           from "../action/index.js"
import { executeView, relationModelRegistry, makeDedupeCache } from "./executor.js"

// ── RawSource ─────────────────────────────────────────────────────────────────

export type RawSource<TServices, TSession, TResult> = {
  readonly __type:      "raw"
  readonly execute:     (ctx: RawContext<TServices, TSession>) => Promise<TResult>
  readonly _resultType: TResult
}

// ── Source union ──────────────────────────────────────────────────────────────

type AnyBoundView     = BoundViewDescriptor<any, any, any, any, any>
type AnyRawSource     = RawSource<any, any, any>
type AnyActionDef     = ActionDefinition<any, any, any, any>

type DataSource<TServices, TSession> =
  | BoundViewDescriptor<any, any, any, any, any>
  | RawSource<TServices, TSession, any>

// ── Action map types ──────────────────────────────────────────────────────────

type ActionMap<TServices, TSession> = Record<string, ActionDefinition<any, any, TServices, TSession>>

type ActionMapFn<TServices, TSession> = (
  ctx: {
    session:      TSession | undefined
    services:     TServices
    params:       Record<string, string | undefined>
    searchParams: Record<string, string | string[] | undefined>
  }
) => ActionMap<TServices, TSession> | Promise<ActionMap<TServices, TSession>>

type ActionMapOrFn<TServices, TSession> =
  | ActionMap<TServices, TSession>
  | ActionMapFn<TServices, TSession>

// ── Shape inference ───────────────────────────────────────────────────────────

export type ErrorBoundaryMode = "throw" | "structured"

type WrapWithBoundary<T, TMode extends ErrorBoundaryMode> =
  TMode extends "structured"
    ? { data: T; error: null } | { data: null; error: StructuredError }
    : T

type InferDataSourceShape<T, TMode extends ErrorBoundaryMode = "throw"> =
  T extends BoundViewDescriptor<any, any, any, any, any>
    ? WrapWithBoundary<T["shape"], TMode>
    : T extends RawSource<any, any, infer TResult>
      ? WrapWithBoundary<TResult, TMode>
      : never

type InferActionShape<T> =
  T extends ActionDefinition<infer TInput, infer TResult, any, any>
    ? ActionCallable<TInput, TResult>
    : never

// ── InferProps ────────────────────────────────────────────────────────────────

export type InferProps<
  TMap  extends Record<string, any>,
  TMode extends ErrorBoundaryMode = "throw",
> = {
  [K in keyof TMap]:
    TMap[K] extends ActionDefinition<any, any, any, any>
      ? InferActionShape<TMap[K]>
      : InferDataSourceShape<TMap[K], TMode>
}

// ── Chainable bound component ─────────────────────────────────────────────────

export type BoundComponent<TRest extends Record<string, unknown>, TServices, TSession> =
  ComponentType<TRest> & {
    /**
     * Chain action injection after bind().
     * actions() accepts a static map or a function receiving ctx.
     *
     * @example
     * binder.bind(Page, { post: PostData }).actions({ onCreate: createPost })
     * binder.bind(Page, { post: PostData }).actions(ctx => ({
     *   ...(ctx.session?.role === "admin" && { delete: deletePost })
     * }))
     */
    actions<TActionMap extends ActionMap<TServices, TSession>>(
      mapOrFn: TActionMap | ActionMapFn<TServices, TSession>,
    ): ComponentType<TRest>
  }

// ── CreateBinderOptions ───────────────────────────────────────────────────────

export type CreateBinderOptions<TServices, TSession = undefined> = {
  registry:     Registry<TServices, TSession>
  getServices:  (ctx: BindContext) => TServices | Promise<TServices>
  getSession?:  (ctx: BindContext) => TSession | undefined | Promise<TSession | undefined>
  middleware?:  Middleware<TSession, TServices>[]
}

export type BindOptions = {
  errorBoundary?: ErrorBoundaryMode
}

// ── Binder ────────────────────────────────────────────────────────────────────

export type Binder<TServices, TSession = undefined> = {
  /**
   * Inject server-fetched data props into a component.
   * Returns a chainable component — call .actions() to also inject action props.
   */
  bind<
    TMap  extends Record<string, DataSource<TServices, TSession>>,
    TRest extends Record<string, unknown>,
    TMode extends ErrorBoundaryMode = "throw",
  >(
    Component: ComponentType<InferProps<TMap, TMode> & TRest>,
    sources:   TMap,
    options?:  BindOptions & { errorBoundary?: TMode },
  ): BoundComponent<TRest, TServices, TSession>

  /**
   * Inject action props into a component with no data sources.
   * Use for create/form pages that have no initial server data.
   *
   * @example
   * export default binder.actions(NewPostPage, { onCreate: createPost })
   */
  actions<
    TActionMap extends ActionMap<TServices, TSession>,
    TRest      extends Record<string, unknown>,
  >(
    Component: ComponentType<InferProps<TActionMap> & TRest>,
    mapOrFn:   TActionMap | ActionMapFn<TServices, TSession>,
  ): ComponentType<TRest>

  raw<TResult>(
    fn: (ctx: RawContext<TServices, TSession>) => Promise<TResult>,
  ): RawSource<TServices, TSession, TResult>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function registerRelationModels(modelDef: AnyModelDescriptor) {
  for (const [fieldKey, fieldDef] of Object.entries(modelDef.fields)) {
    const f = fieldDef as AnyFieldDescriptor & { model?: AnyModelDescriptor }
    if (f.__type === "relation" && f.model) {
      const cacheKey = `${modelDef.name}.${fieldKey}`
      if (!relationModelRegistry.has(cacheKey)) {
        relationModelRegistry.set(cacheKey, f.model.name)
      }
      registerRelationModels(f.model)
    }
  }
}

function normalizeBindContext(props: Record<string, unknown>): BindContext {
  const ctx: BindContext = {
    params:       (props["params"]       as Record<string, string | undefined>)            ?? {},
    searchParams: (props["searchParams"] as Record<string, string | string[] | undefined>) ?? {},
  }
  if (props["request"] !== undefined) ctx.request = props["request"] as Request
  if (props["runtime"] !== undefined) ctx.runtime = props["runtime"]
  return ctx
}

// ── makeActionCallable — wraps an action executor into a typed callable ───────

function makeActionCallable<TInput, TResult, TServices, TSession>(
  definition:   ActionDefinition<TInput, TResult, TServices, TSession>,
  resolverCtx:  { bind: BindContext; services: TServices; session: TSession | undefined },
): ActionCallable<TInput, TResult> {
  // State — updated as the action progresses
  let pending     = false
  let error:      string | null = null
  let fieldErrors: Record<string, string> | null = null
  let lastResult: TResult | null = null

  const callable = async (input: TInput): Promise<TResult> => {
    pending     = true
    error       = null
    fieldErrors = null

    try {
      const { result, onSuccessResult } = await executeAction(
        definition,
        input,
        resolverCtx,
      )
      lastResult = result

      // Handle onSuccess
      if (onSuccessResult && typeof onSuccessResult === "object") {
        const res = onSuccessResult as OnSuccessResult & Record<string, unknown>
        if ("redirect" in res && typeof res.redirect === "string") {
          // Framework-agnostic: store redirect target for the component to act on
          // v1.0.0 Next.js adapter will call redirect() automatically
          ;(callable as any).__redirect = res.redirect
        }
      }

      return result
    } catch (err: any) {
      if (isTypedriftError(err)) {
        error = err.message
        if ("fields" in err && err.fields) {
          fieldErrors = err.fields as Record<string, string>
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
    pending:     { get: () => pending     },
    error:       { get: () => error       },
    fieldErrors: { get: () => fieldErrors },
    lastResult:  { get: () => lastResult  },
  })

  return callable as unknown as ActionCallable<TInput, TResult>
}

// ── resolveAndInjectActions ────────────────────────────────────────────────────

async function resolveAndInjectActions<TServices, TSession>(
  mapOrFn:     ActionMapOrFn<TServices, TSession>,
  resolverCtx: { bind: BindContext; services: TServices; session: TSession | undefined },
): Promise<Record<string, ActionCallable<any, any>>> {
  const map = typeof mapOrFn === "function"
    ? await mapOrFn({
        session:      resolverCtx.session,
        services:     resolverCtx.services,
        params:       resolverCtx.bind.params,
        searchParams: resolverCtx.bind.searchParams,
      })
    : mapOrFn

  const result: Record<string, ActionCallable<any, any>> = {}
  for (const [key, def] of Object.entries(map)) {
    result[key] = makeActionCallable(def, resolverCtx)
  }
  return result
}

// ── createBinder ──────────────────────────────────────────────────────────────

export function createBinder<TServices, TSession = undefined>(
  options: CreateBinderOptions<TServices, TSession>,
): Binder<TServices, TSession> {
  const { registry, getServices, getSession, middleware: mwStack = [] } = options

  // ── Core execution: resolve services + session ─────────────────────────────

  async function resolveContext(bindCtx: BindContext) {
    const services = await getServices(bindCtx)
    const session  = getSession ? await getSession(bindCtx) : undefined as any
    return { bind: bindCtx, services, session }
  }

  // ── Execute a single data source through middleware ───────────────────────

  async function executeSource(
    key:         string,
    source:      DataSource<TServices, TSession>,
    resolverCtx: { bind: BindContext; services: TServices; session: TSession | undefined },
    dedupe:      ReturnType<typeof makeDedupeCache>,
    errorBoundary: ErrorBoundaryMode,
  ): Promise<[string, unknown]> {
    const mwCtx: MiddlewareContext<TSession, TServices> = {
      params:       resolverCtx.bind.params,
      searchParams: resolverCtx.bind.searchParams,
      request:      resolverCtx.bind.request,
      session:      resolverCtx.session,
      services:     resolverCtx.services,
      operation: source.__type === "bound-view"
        ? { type: "view", model: (source as AnyBoundView).view.model.name, propKey: key }
        : { type: "raw", propKey: key },
    }

    const run = async (): Promise<unknown> => {
      if (source.__type === "raw") {
        return (source as AnyRawSource).execute({
          bind:    resolverCtx.bind,
          services: resolverCtx.services,
          session:  resolverCtx.session,
        })
      }
      if (source.__type === "bound-view") {
        const bv      = source as AnyBoundView
        const viewDef: ViewDescriptor<any, any> = bv.view
        const input   = bv.from(resolverCtx.bind)
        return executeView(
          viewDef.model.name,
          input as Record<string, unknown>,
          viewDef.selectionTree,
          resolverCtx,
          registry,
          bv._nullable  as boolean,
          bv._isList    as boolean,
          viewDef.queryArgDefs,
          dedupe,
        )
      }
      throw new Error(`[typedrift] Unknown source type for prop "${key}".`)
    }

    try {
      const value = await runMiddleware(mwStack as any, mwCtx, run)
      if (errorBoundary === "structured") {
        return [key, { data: value, error: null }]
      }
      return [key, value]
    } catch (err) {
      if (errorBoundary === "structured" && isTypedriftError(err)) {
        return [key, { data: null, error: (err as any).toJSON() }]
      }
      throw err
    }
  }

  // ── bind() ─────────────────────────────────────────────────────────────────

  function bind(
    Component:    ComponentType<any>,
    sources:      Record<string, DataSource<TServices, TSession>>,
    bindOptions:  BindOptions = {},
  ): BoundComponent<any, TServices, TSession> {
    const errorBoundary = bindOptions.errorBoundary ?? "throw"

    for (const source of Object.values(sources)) {
      if (source.__type === "bound-view") {
        registerRelationModels((source as AnyBoundView).view.model)
      }
    }

    // The RSC wrapper — resolves data sources
    const BoundComponent = async (props: Record<string, unknown>) => {
      const bindCtx     = normalizeBindContext(props)
      const resolverCtx = await resolveContext(bindCtx)
      const dedupe      = makeDedupeCache()

      const resolvedEntries = await Promise.all(
        Object.entries(sources).map(([key, source]) =>
          executeSource(key, source, resolverCtx, dedupe, errorBoundary)
        )
      )

      const injected = Object.fromEntries(resolvedEntries)
      return (Component as any)({ ...props, ...injected })
    }

    BoundComponent.displayName = `Typedrift(${
      (Component as any).displayName ?? (Component as any).name ?? "Component"
    })`

    // Attach .actions() to the returned component
    ;(BoundComponent as any).actions = (
      mapOrFn: ActionMapOrFn<TServices, TSession>,
    ) => {
      // Returns a new component that resolves data AND injects actions
      const WithActions = async (props: Record<string, unknown>) => {
        const bindCtx     = normalizeBindContext(props)
        const resolverCtx = await resolveContext(bindCtx)
        const dedupe      = makeDedupeCache()

        // Resolve data sources and actions in parallel
        const [dataEntries, actionProps] = await Promise.all([
          Promise.all(
            Object.entries(sources).map(([key, source]) =>
              executeSource(key, source, resolverCtx, dedupe, errorBoundary)
            )
          ),
          resolveAndInjectActions(mapOrFn, resolverCtx),
        ])

        const injected = {
          ...Object.fromEntries(dataEntries),
          ...actionProps,
        }
        return (Component as any)({ ...props, ...injected })
      }

      WithActions.displayName = `Typedrift.WithActions(${
        (Component as any).displayName ?? (Component as any).name ?? "Component"
      })`

      return WithActions as ComponentType<any>
    }

    return BoundComponent as BoundComponent<any, TServices, TSession>
  }

  // ── actions() standalone ───────────────────────────────────────────────────

  function actions(
    Component: ComponentType<any>,
    mapOrFn:   ActionMapOrFn<TServices, TSession>,
  ): ComponentType<any> {
    const WithActions = async (props: Record<string, unknown>) => {
      const bindCtx     = normalizeBindContext(props)
      const resolverCtx = await resolveContext(bindCtx)
      const actionProps = await resolveAndInjectActions(mapOrFn, resolverCtx)
      return (Component as any)({ ...props, ...actionProps })
    }

    WithActions.displayName = `Typedrift.Actions(${
      (Component as any).displayName ?? (Component as any).name ?? "Component"
    })`

    return WithActions as ComponentType<any>
  }

  // ── raw() ──────────────────────────────────────────────────────────────────

  function raw<TResult>(
    fn: (ctx: RawContext<TServices, TSession>) => Promise<TResult>,
  ): RawSource<TServices, TSession, TResult> {
    return { __type: "raw", execute: fn, _resultType: undefined as any }
  }

  return { bind, actions, raw } as Binder<TServices, TSession>
}

// ── InferActionProps (convenience alias) ─────────────────────────────────────

export type InferActionProps<TMap extends Record<string, ActionDefinition<any, any, any, any>>> = {
  [K in keyof TMap]: InferActionShape<TMap[K]>
}
