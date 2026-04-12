// ─── Executor — v0.3.0 ───────────────────────────────────────────────────────
//
// Changes from v0.2.0:
//   - ctx now carries session alongside services
//   - ResolverContext<TServices, TSession> flows through all resolver calls

import type {
  SelectionTree,
  ResolverContext,
  AnyEntity,
  ResolvedQueryArgs,
  QueryArgDefs,
  ListResult,
  BindContext,
} from "../types/index.js"
import type { Registry } from "../registry/index.js"

export const relationModelRegistry = new Map<string, string>()

// ── Per-request dedup cache ───────────────────────────────────────────────────

export function makeDedupeCache() {
  const cache = new Map<string, Promise<unknown>>()
  return {
    get: (key: string) => cache.get(key),
    set: (key: string, p: Promise<unknown>) => { cache.set(key, p) },
  }
}

function makeDedupeKey(modelName: string, input: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => a.localeCompare(b))
  )
  return `${modelName}:${JSON.stringify(sorted)}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function projectScalars(entity: AnyEntity, scalars: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of scalars) {
    if (key in entity) result[key] = entity[key]
  }
  return result
}

function resolveQueryArgs(defs: QueryArgDefs | null, ctx: BindContext): ResolvedQueryArgs | null {
  if (!defs) return null
  const result: ResolvedQueryArgs = {}
  if (defs.filter)   result.filter   = defs.filter(ctx)
  if (defs.sort)     result.sort     = defs.sort(ctx)
  if (defs.paginate) result.paginate = defs.paginate(ctx)
  return result
}

// ── Resolve entity recursively ────────────────────────────────────────────────

async function resolveEntity<TServices, TSession>(
  modelName: string,
  entity:    AnyEntity,
  tree:      SelectionTree,
  ctx:       ResolverContext<TServices, TSession>,
  registry:  Registry<TServices, TSession>,
): Promise<Record<string, unknown>> {
  const registration = registry._get(modelName)
  if (!registration) {
    throw new Error(`[typedrift] No registration for model "${modelName}".`)
  }

  const result   = projectScalars(entity, tree.scalars)
  const entityId = entity["id"] as string
  const scope    = registry._getScope(modelName)?.(ctx) ?? null

  for (const [relationKey, subTree] of tree.relations) {
    const relationResolver = registration.relations[relationKey]
    if (!relationResolver) {
      throw new Error(
        `[typedrift] No relation resolver for "${modelName}.${relationKey}".`
      )
    }

    const cacheKey     = `${modelName}.${relationKey}`
    const relModelName = relationModelRegistry.get(cacheKey)
    if (!relModelName) {
      throw new Error(
        `[typedrift] Cannot resolve related model for "${modelName}.${relationKey}".`
      )
    }

    const resultMap     = await relationResolver([entity], ctx, { selection: subTree, scope })
    const relationValue = resultMap.get(entityId) ?? null

    if (relationValue === null) {
      result[relationKey] = null
    } else if (Array.isArray(relationValue)) {
      result[relationKey] = await Promise.all(
        (relationValue as AnyEntity[]).map(child =>
          resolveEntity(relModelName, child, subTree, ctx, registry)
        )
      )
    } else {
      result[relationKey] = await resolveEntity(
        relModelName,
        relationValue as AnyEntity,
        subTree,
        ctx,
        registry,
      )
    }
  }

  return result
}

// ── executeView ───────────────────────────────────────────────────────────────

export async function executeView<TServices, TSession>(
  modelName:    string,
  rootInput:    Record<string, unknown>,
  tree:         SelectionTree,
  ctx:          ResolverContext<TServices, TSession>,
  registry:     Registry<TServices, TSession>,
  nullable:     boolean,
  isList:       boolean,
  queryArgDefs: QueryArgDefs | null,
  dedupe:       ReturnType<typeof makeDedupeCache>,
): Promise<unknown> {
  const registration = registry._get(modelName)
  if (!registration) {
    throw new Error(`[typedrift] No registration for model "${modelName}".`)
  }
  if (!registration.root) {
    throw new Error(`[typedrift] Model "${modelName}" has no root resolver.`)
  }

  const scope          = registry._getScope(modelName)?.(ctx) ?? null
  const queryArgs      = resolveQueryArgs(queryArgDefs, ctx.bind)
  const requiredFields = registry._getRequiredFields(modelName)

  for (const relKey of tree.relations.keys()) {
    const fk = registration._relationFKs?.[relKey]
    if (fk) requiredFields.add(fk)
  }

  const dedupeKey = makeDedupeKey(modelName, rootInput)
  const existing  = dedupe.get(dedupeKey)
  if (existing) return existing

  const promise = (async () => {
    const raw = await registration.root!(rootInput, ctx, {
      selection: tree, isList, queryArgs, scope, requiredFields,
    })

    if (isList) {
      const listRaw = raw as any
      const data    = Array.isArray(listRaw)
        ? listRaw
        : Array.isArray(listRaw?.data) ? listRaw.data : []

      const resolved = await Promise.all(
        (data as AnyEntity[]).map(entity =>
          resolveEntity(modelName, entity, tree, ctx, registry)
        )
      )

      return {
        data:    resolved,
        total:   listRaw?.total   ?? null,
        page:    listRaw?.page    ?? queryArgs?.paginate?.page    ?? 1,
        perPage: listRaw?.perPage ?? queryArgs?.paginate?.perPage ?? data.length,
      } satisfies ListResult<unknown>
    }

    if (raw === null) {
      if (!nullable) {
        throw new Error(
          `[typedrift] Root resolver for "${modelName}" returned null ` +
          `but the view is not nullable. Chain .nullable() to allow null.`
        )
      }
      return null
    }

    return resolveEntity(modelName, raw as AnyEntity, tree, ctx, registry)
  })()

  dedupe.set(dedupeKey, promise)
  return promise
}
