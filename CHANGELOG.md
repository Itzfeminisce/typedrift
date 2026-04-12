# Changelog

## 0.1.0 (initial release)

### Added
- `model()` — define the resolvable data graph
- `field` — scalar constructors: `id`, `string`, `number`, `boolean`, `date`
- `ref()` — relation constructor with `.nullable()` and `.list()`
- `Model.view()` — typed subshape that drives both TS inference and server execution
- `view.from()` — attach root input resolver
- `boundView.nullable()` — allow null root results
- `createRegistry()` — register root and relation resolvers per model
- `createBinder()` — app integration boundary with `getServices`
- `binder.bind()` — RSC wrapper that injects typed props
- `binder.raw()` — escape hatch for dynamic reads
- `InferProps` — public type utility for bound component props
- Full ESM + CJS dual build with TypeScript declarations

## 0.2.0

### Added
- `batch.one(foreignKey, fetchFn)` — batched single-relation resolver utility
- `batch.many(foreignKey, fetchFn)` — batched list-relation resolver utility
- `batch.junction(config)` — batched many-to-many resolver utility
- `view(selection, queryArgDefs)` — filter, sort, paginate as second argument
- `view().list()` — formal list view modifier returning `ListResult<T>`
- `registry.scope(model, scopeFn)` — row-level scoping per model
- `registry.validate()` — startup completeness check
- Request deduplication in executor — same model + input = one resolver call
- `meta.requiredFields` — FK fields auto-tracked for relation resolution
- `meta.queryArgs` — resolved query args passed to root resolvers
- `meta.scope` — resolved scope passed to all resolvers
- `meta.isList` — list execution flag on root resolver meta
- `ListResult<T>` — pagination envelope type
- `QueryArgDefs`, `ResolvedQueryArgs`, `RootResolverMeta`, `RelationResolverMeta` types

### Unchanged from v0.1.0
- `model()`, `field`, `ref()` — zero changes
- `view(selection)` single argument — identical behaviour
- Manual resolver pattern — fully valid, resolve helpers are opt-in
- `bind()`, `raw()`, `InferProps` — zero changes
- All 41 v0.1.0 tests pass unchanged

## 0.3.0

### Added
- `getSession` option on `createBinder` — session as first-class context, inferred from return type
- `ctx.session` available in all resolvers, middleware, and raw() sources
- `middleware` array on `createBinder` — runs once per source in bind()
- `middleware.requireAuth()` — built-in: throws ForbiddenError if session absent
- `middleware.requireRole(roles)` — built-in: throws ForbiddenError if role not allowed
- `MiddlewareContext` — typed context available in every middleware function
- `OperationDescriptor` — { type, model, propKey } tells middleware what is executing
- `NotFoundError` — code: NOT_FOUND, status: 404
- `ForbiddenError` — code: FORBIDDEN, status: 403
- `ValidationError` — code: VALIDATION_FAILED, status: 422, carries field messages
- `RateLimitError` — code: RATE_LIMITED, status: 429 (ready for v0.5.0)
- `InternalError` — code: INTERNAL, status: 500
- `isTypedriftError(err)` — type guard
- `errorBoundary: "structured"` option on bind() — returns { data, error } instead of throwing
- `devHandler({ registry, binder })` from `typedrift/dev` — dev-only registry inspector

### Unchanged from v0.2.0
- All batch.*, view(), registry.*, bind(), raw(), InferProps — zero breaking changes
- All 63 v0.1.0 + v0.2.0 tests pass unchanged
- errorBoundary defaults to "throw" — existing bind() calls unaffected

## 0.4.0

### Added
- `action({ input, guard?, execute, onSuccess? })` — server-side mutation definition
- Schema-agnostic — any object with `.parse()` works (Zod, Valibot, Arktype, Yup)
- `action.inputSchema` — client-safe schema reference, no server code
- `binder.actions(Component, mapOrFn)` — standalone action injector for data-free pages
- `binder.bind(Component, sources).actions(mapOrFn)` — chainable from bind()
- `actions()` accepts static map OR `(ctx) => map` function for conditional actions
- Conditional actions typed as present/absent — component uses prop presence as permission
- `ActionCallable<TInput, TResult>` — typed callable with `.pending`, `.error`, `.fieldErrors`, `.lastResult`
- `InferActionProps<TMap>` — type utility for action prop shapes
- Field error extraction for Zod, Valibot, and Yup error shapes
- `onSuccess` callback with `{ redirect }` and `{ revalidate }` support
- Guard function receives validated input — enables record-level ownership checks
- `BoundComponent` type — bind() return value with `.actions()` method attached

### Unchanged from v0.3.0
- All bind(), raw(), InferProps, middleware, session, errors — zero breaking changes
- All 88 v0.1.0–v0.3.0 tests pass unchanged
