// ─── Registry — v0.3.0 ───────────────────────────────────────────────────────

import type {
  AnyEntity,
  RootResolverMeta,
  RelationResolverMeta,
  ResolverContext,
} from "../types/index.js"
import type { AnyModelDescriptor } from "../field/index.js"

// ── Resolver types ────────────────────────────────────────────────────────────

export type RootResolver<TInput, TEntity, TServices, TSession = undefined> = (
  input: TInput,
  ctx:   ResolverContext<TServices, TSession>,
  meta:  RootResolverMeta,
) => Promise<TEntity | null>

export type RelationResolver<TParent extends AnyEntity, TValue, TServices, TSession = undefined> = (
  parents: TParent[],
  ctx:     ResolverContext<TServices, TSession>,
  meta:    RelationResolverMeta,
) => Promise<Map<string, TValue>>

// ── ModelRegistration ─────────────────────────────────────────────────────────

export type ModelRegistration<TServices, TSession = undefined> = {
  root?:       RootResolver<any, AnyEntity, TServices, TSession>
  relations:   Record<string, RelationResolver<AnyEntity, unknown, TServices, TSession>>
  _relationFKs?: Record<string, string>
}

export type ScopeFn<TServices, TSession = undefined> = (
  ctx: ResolverContext<TServices, TSession>,
) => Record<string, unknown>

// ── Registry ──────────────────────────────────────────────────────────────────

export type Registry<TServices, TSession = undefined> = {
  register(
    model:        AnyModelDescriptor,
    registration: ModelRegistration<TServices, TSession>,
  ): void

  scope(
    model:   AnyModelDescriptor,
    scopeFn: ScopeFn<TServices, TSession>,
  ): void

  validate(): void

  _get(modelName: string):      ModelRegistration<TServices, TSession> | undefined
  _hasRoot(modelName: string):  boolean
  _getScope(modelName: string): ScopeFn<TServices, TSession> | undefined
  _getRequiredFields(modelName: string): Set<string>
}

// ── createRegistry ────────────────────────────────────────────────────────────

export function createRegistry<TServices, TSession = undefined>(): Registry<TServices, TSession> {
  const registrations = new Map<string, ModelRegistration<TServices, TSession>>()
  const scopes        = new Map<string, ScopeFn<TServices, TSession>>()

  return {
    register(model, registration) {
      if (registrations.has(model.name)) {
        throw new Error(
          `[typedrift] model "${model.name}" is already registered.`
        )
      }
      registrations.set(model.name, registration)
    },

    scope(model, scopeFn) {
      scopes.set(model.name, scopeFn)
    },

    validate() {
      const issues: string[] = []
      for (const [modelName, reg] of registrations) {
        for (const relationKey of Object.keys(reg.relations)) {
          if (typeof reg.relations[relationKey] !== "function") {
            issues.push(`  ${modelName}.${relationKey} — resolver is not a function`)
          }
        }
      }
      if (issues.length > 0) {
        throw new Error(
          `[typedrift] Registry validation failed:\n${issues.join("\n")}`
        )
      }
    },

    _get(modelName)          { return registrations.get(modelName) },
    _hasRoot(modelName)      { return registrations.get(modelName)?.root !== undefined },
    _getScope(modelName)     { return scopes.get(modelName) },
    _getRequiredFields(modelName) {
      const reg = registrations.get(modelName)
      if (!reg?._relationFKs) return new Set()
      return new Set(Object.values(reg._relationFKs))
    },
  }
}
