# Typedrift adapters

Use this file when the task depends on framework integration details.

## Import map

```ts
import { createBinder } from "typedrift"
import { createNextBinder } from "typedrift/next"
import { createStartBinder } from "typedrift/start"
```

Choose exactly one based on the app runtime.

## `createBinder`

Use for framework-agnostic or custom integrations.

```ts
const binder = createBinder({
  registry,
  getServices,
  getSession,
})
```

## `createNextBinder`

Use for Next.js App Router.

```ts
const binder = createNextBinder({
  registry,
  getServices,
  getSession,
})
```

Typical usage:

- page files usually `export default binder.bind(...)`
- SSE route usually exports `GET = binder.liveHandler()`

Cache default:

- If `cache.defaultTtl` is provided without a `store`, the Next adapter uses `unstable_cache`

## `createStartBinder`

Use for TanStack Start.

```ts
const binder = createStartBinder({
  registry,
  getServices,
  getSession,
})
```

Typical usage:

```tsx
const BoundPage = binder.bind(Page, { post: PostData.live() })

export const Route = createFileRoute("/posts/$postId")({
  component: BoundPage,
})
```

Cache default:

- If `cache.defaultTtl` is provided without a `store`, the Start adapter uses `memoryCacheStore()`
- This is fine for development, but production apps usually provide Redis or another external store

## Portability rule

Most Typedrift code should stay identical across adapters:

- models
- registry
- views
- actions
- component bodies
- `useLiveData()` calls

The main differences are:

- binder import
- route/export wrapper shape
- cache default behavior
- explicit SSE route file conventions

## Adapter mistakes to avoid

- Do not import `createNextBinder` in TanStack Start files.
- Do not import `createStartBinder` in Next.js App Router files.
- Do not rewrite portable Typedrift code just because the route file wrapper changes.
