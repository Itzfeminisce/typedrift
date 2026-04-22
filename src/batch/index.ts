// ─── batch utilities ──────────────────────────────────────────────────────────
//
// ORM-agnostic batching helpers. The library handles the Map pattern.
// The developer owns the DB call entirely.
//
// batch.one()      — single relation (FK on parent)
// batch.many()     — list relation  (FK on child)
// batch.junction() — many-to-many via junction table

import type {
  AnyEntity,
  ResolverContext,
  SelectionTree,
  RelationResolverMeta,
} from "../types/index.js"

// ── Fetch function types ──────────────────────────────────────────────────────

export type BatchFetchFn<TServices, TSession, TResult> = (
  ids:       string[],
  ctx:       ResolverContext<TServices, TSession>,
  selection: SelectionTree,
) => Promise<TResult[]>

export type JunctionFetchFn<TServices, TSession, TJunction> = (
  parentIds: string[],
  ctx:       ResolverContext<TServices, TSession>,
) => Promise<TJunction[]>

export type TargetFetchFn<TServices, TSession, TTarget> = (
  childIds:  string[],
  ctx:       ResolverContext<TServices, TSession>,
  selection: SelectionTree,
) => Promise<TTarget[]>

// ── BatchResolver type — matches the existing RelationResolver contract ────────

export type BatchResolver<TServices, TSession, TValue> = (
  parents: AnyEntity[],
  ctx:     ResolverContext<TServices, TSession>,
  meta:    RelationResolverMeta,
) => Promise<Map<string, TValue>>

// ── batch.one ─────────────────────────────────────────────────────────────────

/**
 * Batched single-relation resolver.
 * Use when the FK lives on the parent entity (Post.authorId → User).
 *
 * @param foreignKey  Field name on the parent entity holding the FK value
 * @param fetchFn     Receives deduplicated FK ids, returns matching entities
 *
 * @example
 * author: batch.one("authorId", (ids, ctx) =>
 *   ctx.services.db.user.findMany({ where: { id: { in: ids } } })
 * )
 */
function one<TServices, TSession = undefined, TResult extends AnyEntity = AnyEntity>(
  foreignKey: string,
  fetchFn:    BatchFetchFn<TServices, TSession, TResult>,
): BatchResolver<TServices, TSession, TResult | null> {
  return async (parents, ctx, meta) => {
    if (parents.length === 0) return new Map()

    // Extract unique FK values from parents
    const fkValues = [
      ...new Set(
        parents
          .map(p => p[foreignKey] as string | null | undefined)
          .filter((v): v is string => typeof v === "string"),
      ),
    ]

    if (fkValues.length === 0) {
      return new Map(parents.map(p => [p["id"] as string, null]))
    }

    // Developer owns the DB call
    const results = await fetchFn(fkValues, ctx, meta.selection)

    // Build lookup map by result id
    const byId = new Map(results.map(r => [r["id"] as string, r]))

    // Map each parent to its related entity
    return new Map(
      parents.map(p => [
        p["id"] as string,
        byId.get(p[foreignKey] as string) ?? null,
      ])
    )
  }
}

// ── batch.many ────────────────────────────────────────────────────────────────

/**
 * Batched list-relation resolver.
 * Use when the FK lives on the child entity (Comment.postId → Post).
 *
 * @param foreignKey  Field name on the child entity holding the parent FK
 * @param fetchFn     Receives parent ids, returns all matching child entities
 *
 * @example
 * comments: batch.many("postId", (ids, ctx) =>
 *   ctx.services.db.comment.findMany({ where: { postId: { in: ids } } })
 * )
 */
function many<TServices, TSession = undefined, TResult extends AnyEntity = AnyEntity>(
  foreignKey: string,
  fetchFn:    BatchFetchFn<TServices, TSession, TResult>,
): BatchResolver<TServices, TSession, TResult[]> {
  return async (parents, ctx, meta) => {
    if (parents.length === 0) return new Map()

    const parentIds = parents.map(p => p["id"] as string)

    // Developer owns the DB call — receives parent ids
    const results = await fetchFn(parentIds, ctx, meta.selection)

    // Group children by their FK value (which points to parent id)
    const grouped = new Map<string, TResult[]>()
    for (const result of results) {
      const fkValue = result[foreignKey] as string
      if (!grouped.has(fkValue)) grouped.set(fkValue, [])
      grouped.get(fkValue)!.push(result)
    }

    // Every parent gets an array — empty if no children
    return new Map(
      parents.map(p => [
        p["id"] as string,
        grouped.get(p["id"] as string) ?? [],
      ])
    )
  }
}

// ── batch.junction ────────────────────────────────────────────────────────────

export type JunctionConfig<
  TServices,
  TSession,
  TJunction extends AnyEntity,
  TTarget extends AnyEntity,
> = {
  /** FK on junction row pointing to parent */
  parentKey:     string
  /** FK on junction row pointing to child/target */
  childKey:      string
  /** Fetch junction rows for the given parent ids */
  fetchJunction: JunctionFetchFn<TServices, TSession, TJunction>
  /** Fetch target entities for the given child ids */
  fetchTargets:  TargetFetchFn<TServices, TSession, TTarget>
}

/**
 * Batched many-to-many resolver via a junction table.
 * Always explicit — junction table naming is never inferred.
 *
 * @example
 * tags: batch.junction({
 *   parentKey:     "postId",
 *   childKey:      "tagId",
 *   fetchJunction: (ids, ctx) =>
 *     ctx.services.db.postTag.findMany({ where: { postId: { in: ids } } }),
 *   fetchTargets:  (ids, ctx) =>
 *     ctx.services.db.tag.findMany({ where: { id: { in: ids } } }),
 * })
 */
function junction<
  TServices,
  TSession = undefined,
  TJunction extends AnyEntity = AnyEntity,
  TTarget extends AnyEntity = AnyEntity,
>(
  config: JunctionConfig<TServices, TSession, TJunction, TTarget>,
): BatchResolver<TServices, TSession, TTarget[]> {
  return async (parents, ctx, meta) => {
    if (parents.length === 0) return new Map()

    const parentIds = parents.map(p => p["id"] as string)

    // Step 1 — fetch junction rows
    const junctionRows = await config.fetchJunction(parentIds, ctx)
    if (junctionRows.length === 0) {
      return new Map(parents.map(p => [p["id"] as string, []]))
    }

    // Step 2 — extract unique child ids
    const childIds = [
      ...new Set(
        junctionRows.map(j => j[config.childKey] as string)
      ),
    ]

    // Step 3 — fetch target entities
    const targets = await config.fetchTargets(childIds, ctx, meta.selection)
    const targetById = new Map(targets.map(t => [t["id"] as string, t]))

    // Step 4 — group targets by parent via junction
    const grouped = new Map<string, TTarget[]>()
    for (const row of junctionRows) {
      const parentId = row[config.parentKey] as string
      const childId  = row[config.childKey]  as string
      const target   = targetById.get(childId)
      if (!target) continue
      if (!grouped.has(parentId)) grouped.set(parentId, [])
      grouped.get(parentId)!.push(target)
    }

    return new Map(
      parents.map(p => [
        p["id"] as string,
        grouped.get(p["id"] as string) ?? [],
      ])
    )
  }
}

// ── Public export ─────────────────────────────────────────────────────────────

export const batch = { one, many, junction }
