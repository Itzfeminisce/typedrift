// ─── Core shared types ────────────────────────────────────────────────────────

/**
 * The resolved shape of a selection tree — tells resolvers exactly which
 * fields and relations were requested so they can optimise DB queries.
 */
export type SelectionTree = {
  scalars: Set<string>
  relations: Map<string, SelectionTree>
}

/**
 * Runtime context available in .from() callbacks and raw() sources.
 */
export type BindContext = {
  params: Record<string, string | undefined>
  searchParams: Record<string, string | string[] | undefined>
  request?: Request | undefined
  runtime?: unknown | undefined
}

/**
 * Context passed into every resolver (root and relation).
 */
export type ResolverContext<TServices> = {
  bind: BindContext
  services: TServices
}

/**
 * Context passed into raw() sources.
 */
export type RawContext<TServices> = {
  bind: BindContext
  services: TServices
}

/**
 * Internal entity returned from DB — shape is owned by the resolver,
 * not by Typedrift.
 */
export type AnyEntity = Record<string, unknown>

/**
 * Utility: remove never-typed keys from an object type.
 */
export type OmitNever<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K]
}
