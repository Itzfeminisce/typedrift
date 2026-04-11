// ─── Executor ─────────────────────────────────────────────────────────────────
//
// Walks the SelectionTree, calls resolvers in order, assembles final shape.
// Server-only. Never imported on the client.

import type { SelectionTree, ResolverContext, AnyEntity } from "../types/index.js"
import type { Registry } from "../registry/index.js"

// ── Relation model name registry ──────────────────────────────────────────────
// Populated at bind() time from field descriptors so the executor
// knows which model name to use when resolving nested relations.

export const relationModelRegistry = new Map<string, string>()

// ── Project scalars ───────────────────────────────────────────────────────────

function projectScalars(
  entity: AnyEntity,
  scalars: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of scalars) {
    if (key in entity) {
      result[key] = entity[key]
    }
  }
  return result
}

// ── Resolve entity recursively ────────────────────────────────────────────────

async function resolveEntity<TServices>(
  modelName: string,
  entity: AnyEntity,
  tree: SelectionTree,
  ctx: ResolverContext<TServices>,
  registry: Registry<TServices>,
): Promise<Record<string, unknown>> {
  const registration = registry._get(modelName)
  if (!registration) {
    throw new Error(
      `[typedrift] No registration for model "${modelName}". ` +
      `Call registry.register(${modelName}, ...) before using it.`
    )
  }

  const result = projectScalars(entity, tree.scalars)
  const entityId = entity["id"] as string

  for (const [relationKey, subTree] of tree.relations) {
    const relationResolver = registration.relations[relationKey]
    if (!relationResolver) {
      throw new Error(
        `[typedrift] No relation resolver for "${modelName}.${relationKey}". ` +
        `Add it to registry.register(${modelName}, { relations: { ${relationKey}: ... } }).`
      )
    }

    const cacheKey = `${modelName}.${relationKey}`
    const relModelName = relationModelRegistry.get(cacheKey)
    if (!relModelName) {
      throw new Error(
        `[typedrift] Cannot resolve related model for "${modelName}.${relationKey}". ` +
        `This is an internal error — please report it.`
      )
    }

    const resultMap = await relationResolver([entity], ctx, { selection: subTree })
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

// ── executeView — public entry point ──────────────────────────────────────────

export async function executeView<TServices>(
  modelName: string,
  rootInput: Record<string, unknown>,
  tree: SelectionTree,
  ctx: ResolverContext<TServices>,
  registry: Registry<TServices>,
  nullable: boolean,
): Promise<unknown> {
  const registration = registry._get(modelName)
  if (!registration) {
    throw new Error(
      `[typedrift] No registration for model "${modelName}". ` +
      `Call registry.register(${modelName}, ...).`
    )
  }

  if (!registration.root) {
    throw new Error(
      `[typedrift] Model "${modelName}" has no root resolver. ` +
      `Add one in registry.register(${modelName}, { root: async (input, ctx) => ... }).`
    )
  }

  const entity = await registration.root(rootInput, ctx, { selection: tree })

  if (entity === null) {
    if (!nullable) {
      throw new Error(
        `[typedrift] Root resolver for "${modelName}" returned null, ` +
        `but the bound view is not nullable. ` +
        `Chain .nullable() on your bound view to allow null results.`
      )
    }
    return null
  }

  return resolveEntity(modelName, entity, tree, ctx, registry)
}
