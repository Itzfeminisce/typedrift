# Typedrift middleware

Use this file when a task involves auth, policy, auditing, or rate limiting around Typedrift sources.

## Binder-level middleware

Middleware is configured on the binder and runs around Typedrift operations.

```ts
import {
  middleware,
  auditMiddleware,
  rateLimitMiddleware,
  redisCacheStore,
} from "typedrift"

export const binder = createNextBinder<AppServices, AppSession>({
  registry,
  getServices: async () => ({ db }),
  getSession: async (ctx) => getSession(ctx.request!),
  cache: {
    store: redisCacheStore(redis),
    defaultTtl: 60,
  },
  middleware: [
    middleware.requireAuth(),
    rateLimitMiddleware({
      filter: "actions",
      store: { increment: async () => 1 },
      window: "1m",
      max: 100,
      key: (ctx) => ctx.session?.userId ?? "anon",
    }),
    auditMiddleware({
      filter: "actions",
      redact: (entry) => ({ ...entry, input: "REDACTED" }),
      onEntry: async (entry, ctx) => {
        await ctx.services.db.auditLog.create({ data: entry })
      },
    }),
  ],
})
```

## Built-in helpers

Use built-ins when they fit:

- `middleware.requireAuth()`
- `middleware.requireRole(["admin"])`

Use middleware for global access or policy checks across many sources.

## `guard` vs middleware

Use `guard` inside `action()` when the check is specific to that mutation or record.

Use middleware when the rule is cross-cutting:

- all actions require auth
- all admin operations require a role
- all writes should be audited
- all actions should be rate-limited

## Filtering middleware

Use `withFilter()` or middleware options with `filter` when the rule should only apply to some operations.

Available filter shapes include:

- `"all"`
- `"actions"`
- `"views"`
- string arrays
- predicate functions

Examples:

```ts
withFilter("actions", myMiddleware)
withFilter(["Post", "deletePost"], myMiddleware)
```

## Audit middleware

Use `auditMiddleware()` for action or operation logging with redaction.

Typical pattern:

- `filter: "actions"`
- redact sensitive inputs
- write the entry asynchronously using `ctx.services`

## Rate limiting

Use `rateLimitMiddleware()` with:

- `store`
- `window`
- `max`
- `key`

The `store` must implement:

```ts
type RateLimitStore = {
  increment(key: string, windowMs: number): Promise<number>
}
```

## Practical rule

Keep middleware close to binder setup and keep component code unaware of it. If a task starts pulling auth or audit orchestration into the React component body, move that logic back to middleware or action definitions.
