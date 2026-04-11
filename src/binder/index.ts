// ─── Binder ───────────────────────────────────────────────────────────────────

import type { ComponentType } from "react"
import type { BindContext, RawContext } from "../types/index.js"
import type { Registry } from "../registry/index.js"
import type { BoundViewDescriptor, ViewDescriptor } from "../view/index.js"
import type { AnyModelDescriptor, AnyFieldDescriptor } from "../field/index.js"
import { executeView, relationModelRegistry } from "./executor.js"

// ── RawSource ─────────────────────────────────────────────────────────────────

export type RawSource<TServices, TResult> = {
  readonly __type: "raw"
  readonly execute: (ctx: RawContext<TServices>) => Promise<TResult>
  readonly _resultType: TResult
}

// ── Prop sources ──────────────────────────────────────────────────────────────

type AnyBoundView = BoundViewDescriptor<any, any, any, any>
type AnyRawSource = RawSource<any, any>
type PropSource<TServices> =
  | BoundViewDescriptor<any, any, any, any>
  | RawSource<TServices, any>

type InferSourceShape<T> =
  T extends BoundViewDescriptor<any, any, any, any>
    ? T["shape"]
    : T extends RawSource<any, infer TResult>
      ? TResult
      : never

// ── InferProps ────────────────────────────────────────────────────────────────

/**
 * Infer the prop types injected by binder.bind() from a bind map.
 *
 * @example
 * type Props = InferProps<{ post: typeof PostData }>
 */
export type InferProps<TMap extends Record<string, any>> = {
  [K in keyof TMap]: InferSourceShape<TMap[K]>
}

// ── CreateBinderOptions ───────────────────────────────────────────────────────

export type CreateBinderOptions<TServices> = {
  registry: Registry<TServices>
  getServices: (ctx: BindContext) => TServices | Promise<TServices>
}

// ── Binder ────────────────────────────────────────────────────────────────────

export type Binder<TServices> = {
  /**
   * Wrap a React Server Component. Executes all sources on the server and
   * injects typed props — the component never writes fetch logic.
   */
  bind<
    TMap extends Record<string, PropSource<TServices>>,
    TRest extends Record<string, unknown>,
  >(
    Component: ComponentType<InferProps<TMap> & TRest>,
    sources: TMap,
  ): ComponentType<TRest>

  /**
   * Define a raw server-side data source. Bypasses model/view derivation
   * but still runs through the binder's service layer.
   */
  raw<TResult>(
    fn: (ctx: RawContext<TServices>) => Promise<TResult>,
  ): RawSource<TServices, TResult>
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
    params: (props["params"] as Record<string, string | undefined>) ?? {},
    searchParams:
      (props["searchParams"] as Record<string, string | string[] | undefined>) ?? {},
  }
  if (props["request"] !== undefined) {
    ctx.request = props["request"] as Request
  }
  if (props["runtime"] !== undefined) {
    ctx.runtime = props["runtime"]
  }
  return ctx
}

// ── createBinder ──────────────────────────────────────────────────────────────

export function createBinder<TServices>(
  options: CreateBinderOptions<TServices>,
): Binder<TServices> {
  const { registry, getServices } = options

  return {
    raw(fn) {
      return {
        __type: "raw",
        execute: fn,
        _resultType: undefined as any,
      }
    },

    bind(Component, sources) {
      // Pre-register relation model names at bind() time
      for (const source of Object.values(sources)) {
        if (source.__type === "bound-view") {
          registerRelationModels((source as AnyBoundView).view.model)
        }
      }

      const BoundComponent = async (props: Record<string, unknown>) => {
        const bindCtx = normalizeBindContext(props)
        const services = await getServices(bindCtx)
        const resolverCtx = { bind: bindCtx, services }

        const resolvedEntries = await Promise.all(
          Object.entries(sources).map(async ([key, source]) => {
            if (source.__type === "raw") {
              const value = await (source as AnyRawSource).execute({
                bind: bindCtx,
                services,
              })
              return [key, value] as const
            }

            if (source.__type === "bound-view") {
              const bv = source as AnyBoundView
              const viewDef: ViewDescriptor<any, any> = bv.view
              const input = bv.from(bindCtx)
              const value = await executeView(
                viewDef.model.name,
                input as Record<string, unknown>,
                viewDef.selectionTree,
                resolverCtx,
                registry,
                bv._nullable as boolean,
              )
              return [key, value] as const
            }

            throw new Error(
              `[typedrift] Unknown source type for prop "${key}". ` +
              `Expected a bound view or raw source.`
            )
          })
        )

        const injected = Object.fromEntries(resolvedEntries)
        return (Component as any)({ ...props, ...injected })
      }

      BoundComponent.displayName = `Typedrift(${
        (Component as any).displayName ?? (Component as any).name ?? "Component"
      })`

      return BoundComponent as unknown as ComponentType<any>
    },
  }
}
