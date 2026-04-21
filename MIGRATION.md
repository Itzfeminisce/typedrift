# Typedrift — Migration Guide

## v0.x → v1.0.0

v1.0.0 is the API stability commitment. The public surface is now
semver-frozen — breaking changes require a major version bump.

This guide covers every change you need to make.

---

## Breaking changes

### 1. The "list" string convention is removed

In v0.2.0 a string `"list"` could be passed to `.from()` as a signal
for list mode. This was deprecated in v0.3.0. It is removed in v1.0.0.

```ts
// v0.2.0 — deprecated, now removed
Post.view({ title: true }, { paginate: ... })
  .from(() => "list")

// v1.0.0 — use .list() instead
Post.view({ title: true }, { paginate: ... })
  .list()
  .from(() => ({}))
```

**How to find usages:** search your codebase for `.from(() => "list")`
or `.from((_) => "list")`. Every match needs the `.list()` modifier
added before `.from()`.

---

### 2. Session via services is no longer the recommended pattern

In v0.1.0 and v0.2.0 session had to be extracted inside `getServices`
and attached to the services object as a workaround:

```ts
// v0.1.0 / v0.2.0 workaround — still works but discouraged
getServices: async (ctx) => ({
  db,
  session: await getSessionFromRequest(ctx.request),
})

// In resolvers:
ctx.services.session.userId  // session as a service — wrong
```

This pattern still works in v1.0.0 but `ctx.services.session` will
not benefit from the typed session generic. Use `getSession` instead:

```ts
// v1.0.0 — correct pattern
createBinder({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => getSessionFromRequest(ctx.request),
})

// In resolvers:
ctx.session.userId  // typed, first-class
```

**Migration:** move session extraction from `getServices` into `getSession`.
Remove `session` from your services type. Replace `ctx.services.session`
with `ctx.session` throughout.

---

## Non-breaking changes in v1.0.0

These are new in v1.0.0 and opt-in. Existing code is unaffected.

### Type audit — InferProps edge cases verified

The following edge cases are now covered by the test suite and
guaranteed by the API contract:

- `view().list()` → `InferProps` produces `ListResult<T>`, not `T[]`
- `errorBoundary: "structured"` wraps data sources with `{ data, error }`
  but never wraps `ActionCallable` — actions keep their callable shape
- `ActionCallable.error` is action execution state, not a structured
  error envelope — `typeof create.error === "string | null"`

---

## What is frozen at v1.0.0

The following exports are semver-stable. Breaking changes to any of
these require a v2.0.0 release.

**Core**
- `model(name, fields)`
- `field.id()`, `field.string()`, `field.number()`, `field.boolean()`, `field.date()`
- `field.*.nullable()`
- `ref(model)`, `ref(model).nullable()`, `ref(model).list()`

**View**
- `Model.view(selection, queryArgDefs?, cacheConfig?)`
- `view.list()`
- `view.from(resolver)`
- `boundView.nullable()`

**Registry**
- `createRegistry<TServices, TSession>()`
- `registry.register(model, { root?, relations })`
- `registry.scope(model, scopeFn)`
- `registry.validate()`

**Batch utilities**
- `batch.one(foreignKey, fetchFn)`
- `batch.many(foreignKey, fetchFn)`
- `batch.junction(config)`

**Binder**
- `createBinder({ registry, getServices, getSession?, middleware?, cache?, tracer? })`
- `binder.bind(Component, sources, options?)`
- `binder.bind(...).actions(mapOrFn)`
- `binder.actions(Component, mapOrFn)`
- `binder.raw(fn)`

**Action**
- `action({ input, guard?, execute, onSuccess? })`
- `action.inputSchema`

**Middleware**
- `middleware.requireAuth()`
- `middleware.requireRole(roles)`
- `withFilter(filter, middleware)`
- `auditMiddleware(options)`
- `rateLimitMiddleware(options)`
- `runMiddleware(stack, ctx, fn)`

**Cache**
- `memoryCacheStore()`
- `redisCacheStore(redis)`

**Telemetry**
- `openTelemetryTracer(otelTracer)`

**Errors**
- `NotFoundError`, `ForbiddenError`, `ValidationError`
- `RateLimitError`, `InternalError`
- `isTypedriftError(err)`

**Types**
- `InferProps<TMap, TMode?>`
- `InferActionProps<TMap>`
- `InferViewShape<TView>`
- `InferBoundViewShape<TBoundView>`
- `InferActionInput<TAction>`
- `InferActionResult<TAction>`
- `SelectionTree`, `BindContext`, `ResolverContext<TServices, TSession>`
- `RawContext<TServices, TSession>`
- `ListResult<T>`, `StructuredError`, `AuditEntry`
- `TypedriftErrorCode`, `ErrorBoundaryMode`
- `MiddlewareFilter`, `OperationDescriptor`
- `CacheStore`, `CacheConfig`, `ViewCacheConfig`
- `TypedriftTracer`, `TypedriftSpan`

---

## What is NOT frozen (may change in minor versions)

- Internal executor implementation
- Dev tools endpoint (`typedrift/dev`) response shape
- Built-in middleware internal implementation details
- Cache store internal interfaces beyond the public `CacheStore` type

---

## Ecosystem packages (not in this release)

The following are planned as separate packages with their own semver:

- `typedrift-next` — Next.js App Router adapter (v1.1.0)
- `typedrift-drizzle` — Drizzle ORM adapter (v1.2.0)
- `typedrift-cli` — registry validation CLI (v1.3.0)

They are separate packages so their dependencies (Next.js, Drizzle)
do not affect the core `typedrift` package version.

---

## Checklist

Before upgrading to v1.0.0, verify:

- [ ] No `.from(() => "list")` usage — replace with `.list().from(() => ({}))`
- [ ] Session moved from `getServices` to `getSession` (if used)
- [ ] `ctx.services.session` replaced with `ctx.session` (if used)
- [ ] `registry.validate()` called at startup in development
- [ ] TypeScript version is 5.0+ (required for exact generic inference)
- [ ] React version is 19.0+ (required for RSC async components)
