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

## 0.5.0

### Added

**Middleware filter system**
- `MiddlewareFilter<TSession, TServices>` type — "all" | "actions" | "views" | string[] | predicate fn
- `evalFilter(filter, ctx)` — resolves any filter form to boolean, sync or async
- `withFilter(filter, middleware)` — wrap any custom middleware with a filter
- `filter` option on all built-in middleware (auditMiddleware, rateLimitMiddleware)
- Predicate form receives full MiddlewareContext including session and services

**Audit middleware**
- `auditMiddleware({ filter?, redact?, onEntry })` — span-compatible audit log
- `AuditEntry` type — who/what/when/outcome, maps directly to OTel span attributes
- `redact()` option — transform entry before onEntry (scrub passwords, tokens)
- Fire-and-forget — audit logging never blocks the response
- Actions run their own middleware pass at invocation time (not render time)

**Rate limit middleware**
- `rateLimitMiddleware({ filter?, store, window, max, key })` — global rate limiting
- `RateLimitStore` interface — `increment(key, windowMs): Promise<number>`
- Window formats: "30s", "1m", "2h", "1d"
- `RateLimitError` thrown on limit exceeded (already in error hierarchy)

**Read caching**
- `CacheConfig` on `createBinder` — `{ store, defaultTtl }`
- `ViewCacheConfig` on `view()` third argument — `{ ttl, tags }`
- `cache: false` on view — opt out of global cache for specific views
- `memoryCacheStore()` — in-process store for development and testing
- `redisCacheStore(redis)` — Redis-backed with tag-based invalidation
- Cache key = model + serialised input + selection hash (unique per view+input)
- `onSuccess.revalidate` wired to cache invalidation — tags purged after action

**Telemetry**
- `TypedriftTracer` interface — minimal, no hard OTel dependency
- `openTelemetryTracer(otelTracer)` — adapts any OTel tracer
- Automatic spans: typedrift.view, typedrift.resolver.root, typedrift.resolver.relation, typedrift.cache, typedrift.action
- Zero overhead when tracer not configured

### Architecture fix
- Action callables now run the middleware stack at **invocation time** (when user triggers the action), not at render time. This means `filter: "actions"` correctly targets user-triggered mutations, and `filter: "views"` correctly targets server render data fetching.

### Unchanged from v0.4.0
- All model, view, bind, actions, raw, InferProps — zero breaking changes
- All 114 v0.1.0–v0.4.0 tests pass unchanged

## 1.0.0 — Stable release

### Breaking changes
- `"list"` string convention removed from `.from()` — use `.list().from(() => ({}))`
- Session via `ctx.services.session` pattern is now discouraged in favour of `getSession` + `ctx.session`

### Added
- `MIGRATION.md` — complete migration guide from v0.x
- Type audit test suite verifying `InferProps` edge cases are correct
- `type-audit.test.ts` — 7 type-level + runtime assertions covering critical shapes

### Stability guarantee
All exports listed in MIGRATION.md under "What is frozen" are semver-stable.
Breaking changes to any of these require a v2.0.0 release.

### All 147 tests pass
- v0.1.0 integration tests (12)
- v0.2.0 batch/scope/dedup/validate (22)
- v0.3.0 session/middleware/errors (25)
- v0.4.0 action/guard/validation/chains (26)
- v0.5.0 filter/audit/ratelimit/cache/tracer (26)
- model-view (15), registry (6), field (8)
- type-audit (7) — new in v1.0.0

## 1.1.0

### Added — Framework adapters

**typedrift/next — Next.js App Router adapter**
- `createNextBinder(options)` — drop-in replacement for `createBinder`
- Auto-wires `params` from Next.js dynamic segment page props
- Auto-wires `searchParams` from Next.js page props
- Handles Promise-wrapped props (Next.js 15+ async params)
- `onSuccess.redirect` → calls `redirect()` from `next/navigation`
- `onSuccess.revalidate` → calls `revalidateTag()` from `next/cache`
- `session: "cookie"` — thick opt-in: reads Next.js cookies automatically
- `session: { cookie, secret, maxAge }` — config object form
- `cache: { defaultTtl }` without store → uses Next.js `unstable_cache`
- `cache: { store, defaultTtl }` → uses your store (Redis etc)

**typedrift/start — TanStack Start adapter**
- `createStartBinder(options)` — drop-in replacement for `createBinder`
- Auto-wires `params` from TanStack Router route context
- Auto-wires `searchParams` from TanStack Router `search` props
- `onSuccess.redirect` → wires `router.navigate()` (client-side)
- `onSuccess.revalidate` → wires `router.invalidate()` (client-side)
- `session: "cookie"` — thick opt-in: reads request cookies automatically
- `session: { cookie, secret, maxAge }` — config object form
- `cache: { defaultTtl }` without store → uses `memoryCacheStore()`
- `cache: { store, defaultTtl }` → uses your store (Redis etc)

**Package structure**
- `typedrift/next` and `typedrift/start` as subpath exports — one package, one install
- Framework packages are optional peer deps — Next.js users don't pull in TanStack
- Lazy imports — framework modules only loaded when the adapter is actually called

### Unchanged
- Core `typedrift` API — zero changes
- All 147 v1.0.0 tests pass unchanged

## 1.2.0

### Added — CLI

**Commands**
- `npx typedrift check` — validate registry completeness, exit 1 if issues found
- `npx typedrift check --watch` — continuous validation via chokidar, re-checks on save
- `npx typedrift inspect` — full registry state: models, views, resolvers, actions, issues
- `npx typedrift generate` — show what can be generated
- `npx typedrift generate --missing` — scaffold missing resolver stubs (never overwrites)
- `npx typedrift generate --model <n>` — scaffold a new model file
- `npx typedrift --help` — usage reference

**Config**
- `typedrift.config.ts` — project config file with auto-detection
- `defineConfig()` from `typedrift/cli` — typed config helper
- Auto-detects registry file from known locations
- Auto-reads tsconfig path aliases
- Fallback to glob scanning when tsconfig unavailable

**Static analysis**
- `TypedriftAnalyser` — ts-morph based AST scanner (exported from `typedrift/cli`)
- Extracts: models, fields, relations, views, registered resolvers, actions
- `AnalysisIssue` — typed issue shape with severity and usedIn tracking
- Handles missing tsconfig gracefully — falls back to glob scanning

**Package**
- `bin: { "typedrift": "./dist/cli/bin.js" }` — `npx typedrift` just works
- `typedrift/cli` subpath export — `defineConfig` + analysis types for tooling
- CLI built as Node.js target — separate from browser-safe library build

### Unchanged
- Core API, Next.js adapter, Start adapter — zero changes
- All 168 v1.1.0 tests pass unchanged

## 1.4.0

### Added — view().live() realtime SSE

**Core API**
- `boundView.live(options?)` — marks a bound view as SSE-backed, returns `LiveBoundViewDescriptor`
- `boundView.useLiveData()` — React hook attached to the view object, returns `LiveState`
- `CLEAR` sentinel — return from `onData` to explicitly reset the prop to null
- Prop shape is **identical** to the static case — zero InferProps drift

**LiveOptions**
- `interval` — poll fallback ms when no server push arrives
- `enabled` — conditional subscription (boolean or ctx function)
- `tags` — explicit subscription tags function
- `staleTime` — ms before stale: true after disconnect (prevents banner flash)
- `reconnect` — boolean or `{ attempts, delay, backoff, maxDelay }` config
- `onData(incoming, previous, meta)` — transform/accumulate push data; null = keep previous, CLEAR = reset
- `validate` — schema-agnostic push validation (.parse() interface)
- `maxAge` + `onExpire` — temporal validity ("stale" | "refetch" | "clear")

**LiveState (from useLiveData())**
- `stale` — connection dropped, showing last known value
- `loading` — first load or reconnecting
- `error` — validation failure or exhausted reconnect attempts
- `updatedAt` — Date of last successful push
- `pushCount` — total pushes received since mount

**SSE infrastructure**
- `binder.liveHandler()` — explicit SSE route handler for manual registration
- Next.js adapter: `createNextLiveRoute(binder)` — ready-made route export
- One SSE connection per page, multiplexed across multiple live sources
- Heartbeat every 15s to keep connection alive through proxies
- Exponential backoff reconnection by default

**typedrift/react subpath**
- `LiveContext` — React context populated by the binder
- `useLiveDataForKey(key)` — low-level hook (prefer view.useLiveData())
- `LiveProvider` — wraps bound components with live sources
- `LiveSourceConfig`, `LiveProviderProps` types

**AI streaming support**
- `onData` meta carries `{ done, accumulated, pushCount }`
- `accumulated` contains all raw SSE tokens concatenated
- `done` signals stream completion — parse final JSON in this callback
- Pattern: return null mid-stream, return parsed result when done

### Unchanged
- Core API, adapters, CLI — zero breaking changes
- All 190 v1.2.0 tests pass unchanged
