// ─── Core shared types — v0.3.0 ──────────────────────────────────────────────

export type SelectionTree = {
  scalars:         Set<string>
  relations:       Map<string, SelectionTree>
  queryArgs?:      ResolvedQueryArgs
  isList?:         boolean
  requiredFields?: Set<string>
}

export type ResolvedQueryArgs = {
  filter?:   Record<string, unknown>
  sort?:     { field: string; dir: "asc" | "desc" }
  paginate?: { page: number; perPage: number }
}

export type QueryArgDefs = {
  filter?:   (ctx: BindContext) => Record<string, unknown>
  sort?:     (ctx: BindContext) => { field: string; dir: "asc" | "desc" }
  paginate?: (ctx: BindContext) => { page: number; perPage: number }
}

export type ListResult<T> = {
  data:    T[]
  total:   number | null
  page:    number
  perPage: number
}

export type BindContext = {
  params:       Record<string, string | undefined>
  searchParams: Record<string, string | string[] | undefined>
  request?:     Request
  runtime?:     unknown
}

// v0.3.0 — session is now a first-class field on ResolverContext
export type ResolverContext<TServices, TSession = undefined> = {
  bind:     BindContext
  services: TServices
  session:  TSession | undefined
}

export type RawContext<TServices, TSession = undefined> = {
  bind:     BindContext
  services: TServices
  session:  TSession | undefined
}

export type RootResolverMeta = {
  selection:      SelectionTree
  isList:         boolean
  queryArgs:      ResolvedQueryArgs | null
  scope:          Record<string, unknown> | null
  requiredFields: Set<string>
}

export type RelationResolverMeta = {
  selection: SelectionTree
  scope:     Record<string, unknown> | null
}

export type AnyEntity = Record<string, unknown>

export type OmitNever<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K]
}

// v0.5.0 — per-view cache configuration
export type ViewCacheConfig = {
  ttl:   number
  tags?: (input: Record<string, unknown>) => string[]
}
