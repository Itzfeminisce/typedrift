// ─── Executor — v0.5.0 ───────────────────────────────────────────────────────
//
// New in v0.5.0:
//   - Cache check/set around root resolver calls
//   - Tracer spans around view and resolver execution
//   - Tag-based invalidation via onSuccess.revalidate

import type {
  SelectionTree, ResolverContext, AnyEntity,
  ResolvedQueryArgs, QueryArgDefs, ListResult,
  BindContext, ViewCacheConfig,
} from "../types/index.js"
import type { Registry }         from "../registry/index.js"
import type { CacheConfig }      from "../cache/index.js"
import type { TypedriftTracer }  from "../telemetry/index.js"
import {
  buildCacheKey, cacheSetWithTags,
}                                from "../cache/index.js"
import { SpanNames }             from "../telemetry/index.js"

export const relationModelRegistry = new Map<string, string>()

// ── Dedup cache ───────────────────────────────────────────────────────────────

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

// ── Resolve entity ────────────────────────────────────────────────────────────

async function resolveEntity<TServices, TSession>(
  modelName: string,
  entity:    AnyEntity,
  tree:      SelectionTree,
  ctx:       ResolverContext<TServices, TSession>,
  registry:  Registry<TServices, TSession>,
  tracer?:   TypedriftTracer,
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
      throw new Error(`[typedrift] No relation resolver for "${modelName}.${relationKey}".`)
    }

    const cacheKey     = `${modelName}.${relationKey}`
    const relModelName = relationModelRegistry.get(cacheKey)
    if (!relModelName) {
      throw new Error(`[typedrift] Cannot resolve related model for "${modelName}.${relationKey}".`)
    }

    const span = tracer?.startSpan(SpanNames.RESOLVER_RELATION, {
      "typedrift.model":    modelName,
      "typedrift.relation": relationKey,
    })

    try {
      const resultMap = await relationResolver([entity], ctx, { selection: subTree, scope })
      const value     = resultMap.get(entityId) ?? null
      span?.setStatus("ok")

      if (value === null) {
        result[relationKey] = null
      } else if (Array.isArray(value)) {
        result[relationKey] = await Promise.all(
          (value as AnyEntity[]).map(child =>
            resolveEntity(relModelName, child, subTree, ctx, registry, tracer)
          )
        )
      } else {
        result[relationKey] = await resolveEntity(
          relModelName, value as AnyEntity, subTree, ctx, registry, tracer
        )
      }
    } catch (err) {
      span?.setStatus("error", (err as Error).message)
      throw err
    } finally {
      span?.end()
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
  cacheConfig:  ViewCacheConfig | false | null,
  dedupe:       ReturnType<typeof makeDedupeCache>,
  cacheGlobal?: CacheConfig,
  tracer?:      TypedriftTracer,
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

  // ── Cache check ─────────────────────────────────────────────────────────────
  const shouldCache = cacheConfig !== false && cacheGlobal?.store != null
  const cacheKey    = shouldCache ? buildCacheKey(modelName, rootInput, tree) : null

  if (shouldCache && cacheKey && cacheGlobal) {
    const cacheSpan = tracer?.startSpan(SpanNames.CACHE_CHECK, {
      "typedrift.model":      modelName,
      "typedrift.cache.key":  cacheKey,
    })
    try {
      const cached = await cacheGlobal.store.get(cacheKey)
      if (cached !== null) {
        cacheSpan?.setAttributes({ "typedrift.cache.result": "hit" })
        cacheSpan?.setStatus("ok")
        return cached
      }
      cacheSpan?.setAttributes({ "typedrift.cache.result": "miss" })
      cacheSpan?.setStatus("ok")
    } catch {
      cacheSpan?.setAttributes({ "typedrift.cache.result": "error" })
      cacheSpan?.setStatus("error")
    } finally {
      cacheSpan?.end()
    }
  }

  // ── Dedup ───────────────────────────────────────────────────────────────────
  const dedupeKey = makeDedupeKey(modelName, rootInput)
  const existing  = dedupe.get(dedupeKey)
  if (existing) return existing

  const promise = (async () => {
    const rootSpan = tracer?.startSpan(SpanNames.RESOLVER_ROOT, {
      "typedrift.model":   modelName,
      "typedrift.isList":  isList,
    })

    let raw: unknown
    try {
      raw = await registration.root!(rootInput, ctx, {
        selection: tree, isList, queryArgs, scope, requiredFields,
      })
      rootSpan?.setStatus("ok")
    } catch (err) {
      rootSpan?.setStatus("error", (err as Error).message)
      throw err
    } finally {
      rootSpan?.end()
    }

    let resolved: unknown

    if (isList) {
      const listRaw = raw as any
      const data    = Array.isArray(listRaw) ? listRaw
                    : Array.isArray(listRaw?.data) ? listRaw.data : []
      const resolvedData = await Promise.all(
        (data as AnyEntity[]).map(entity =>
          resolveEntity(modelName, entity, tree, ctx, registry, tracer)
        )
      )
      resolved = {
        data:    resolvedData,
        total:   listRaw?.total   ?? null,
        page:    listRaw?.page    ?? queryArgs?.paginate?.page    ?? 1,
        perPage: listRaw?.perPage ?? queryArgs?.paginate?.perPage ?? data.length,
      } satisfies ListResult<unknown>
    } else {
      if (raw === null) {
        if (!nullable) {
          throw new Error(
            `[typedrift] Root resolver for "${modelName}" returned null but view is not nullable.`
          )
        }
        resolved = null
      } else {
        resolved = await resolveEntity(modelName, raw as AnyEntity, tree, ctx, registry, tracer)
      }
    }

    // ── Cache write ───────────────────────────────────────────────────────────
    if (shouldCache && cacheKey && cacheGlobal && resolved !== null) {
      const effectiveConfig = cacheConfig as ViewCacheConfig | null
      const ttl             = effectiveConfig?.ttl ?? cacheGlobal.defaultTtl
      const tags            = effectiveConfig?.tags?.(rootInput) ?? []

      cacheSetWithTags(cacheGlobal.store, cacheKey, resolved, ttl, tags).catch(err => {
        console.warn("[typedrift] Cache write failed:", err)
      })
    }

    return resolved
  })()

  dedupe.set(dedupeKey, promise)
  return promise
}

// ── invalidateCacheTags ───────────────────────────────────────────────────────

export async function invalidateCacheTags(
  tags:        string[],
  cacheGlobal?: CacheConfig,
): Promise<void> {
  if (!cacheGlobal?.store || tags.length === 0) return
  await cacheGlobal.store.invalidate(tags)
}
