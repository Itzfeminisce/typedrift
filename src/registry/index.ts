// ─── Registry ─────────────────────────────────────────────────────────────────
//
// The registry maps model names to their root and relation resolvers.
// It owns nothing about React, RSC, or HTTP — it is a pure data structure
// that the binder executes against.

import type {
  SelectionTree,
  ResolverContext,
  AnyEntity,
} from "../types/index.js"
import type { AnyModelDescriptor } from "../field/index.js"

// ── Resolver types ────────────────────────────────────────────────────────────

/**
 * Root resolver — fetches a single root record given an input.
 * Returns the raw internal entity or null.
 */
export type RootResolver<
  TInput,
  TEntity extends AnyEntity,
  TServices,
> = (
  input: TInput,
  ctx: ResolverContext<TServices>,
  meta: { selection: SelectionTree },
) => Promise<TEntity | null>

/**
 * Relation resolver — batched (dataloader-style).
 * Receives an array of parent entities and must return a Map
 * keyed by parent entity id.
 */
export type RelationResolver<
  TParent extends AnyEntity,
  TValue,
  TServices,
> = (
  parents: TParent[],
  ctx: ResolverContext<TServices>,
  meta: { selection: SelectionTree },
) => Promise<Map<string, TValue>>

// ── ModelRegistration ─────────────────────────────────────────────────────────

export type ModelRegistration<TServices> = {
  root?: RootResolver<any, AnyEntity, TServices>
  relations: Record<string, RelationResolver<AnyEntity, unknown, TServices>>
}

// ── Registry ──────────────────────────────────────────────────────────────────

export type Registry<TServices> = {
  register(
    model: AnyModelDescriptor,
    registration: ModelRegistration<TServices>,
  ): void
  /**
   * Internal: look up a model's registration by name.
   * Used by the binder during execution.
   */
  _get(modelName: string): ModelRegistration<TServices> | undefined
  /**
   * Internal: check if a root resolver exists for a model.
   */
  _hasRoot(modelName: string): boolean
}

// ── createRegistry ────────────────────────────────────────────────────────────

export function createRegistry<TServices>(): Registry<TServices> {
  const registrations = new Map<string, ModelRegistration<TServices>>()

  return {
    register(model, registration) {
      if (registrations.has(model.name)) {
        throw new Error(
          `[typedrift] model "${model.name}" is already registered. ` +
          `Each model may only be registered once.`
        )
      }
      registrations.set(model.name, registration)
    },

    _get(modelName) {
      return registrations.get(modelName)
    },

    _hasRoot(modelName) {
      return registrations.get(modelName)?.root !== undefined
    },
  }
}
