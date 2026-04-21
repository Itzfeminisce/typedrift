# Typedrift setup

Use this file when setting up Typedrift from scratch or checking whether a project is wired correctly.

## Imports

Use these public imports only:

```ts
import { model, field, ref, createRegistry } from "typedrift"
import { createBinder } from "typedrift"
import { createNextBinder } from "typedrift/next"
import { createStartBinder } from "typedrift/start"
import type { InferProps } from "typedrift"
```

For CLI config:

```ts
import { defineConfig } from "typedrift/cli"
```

## 1. Define models

```ts
import { model, field, ref } from "typedrift"

export const User = model("User", {
  id: field.id(),
  name: field.string(),
})

export const Post = model("Post", {
  id: field.id(),
  title: field.string(),
  authorId: field.string(),
  author: ref(User),
})
```

Notes:

- Use `field.*()` helpers for scalar fields.
- Use `ref(OtherModel)` for relations.
- Keep model names stable because registry operations and tooling key off them.

## 2. Register resolvers

```ts
import { createRegistry, batch } from "typedrift"
import { Post, User } from "./models"

export const registry = createRegistry<AppServices, AppSession>()

registry.register(Post, {
  root: async ({ id }, ctx) =>
    ctx.services.db.post.findUnique({ where: { id } }),
  relations: {
    author: batch.one("authorId", (ids, ctx) =>
      ctx.services.db.user.findMany({ where: { id: { in: ids } } })
    ),
  },
})

registry.register(User, {
  root: async ({ id }, ctx) =>
    ctx.services.db.user.findUnique({ where: { id } }),
  relations: {},
})
```

Notes:

- `root` resolves the model instance from the view input.
- `relations` fills `ref()` fields.
- Prefer batch helpers over N+1 style per-row relation lookups.

## 3. Define views

```ts
export const PostData = Post.view({
  title: true,
  author: { name: true },
})
.from(({ params }) => ({ id: params.postId! }))
.nullable()
```

Notes:

- `view({...})` declares the exact bound prop shape.
- `.from(...)` maps route or request context into the root resolver input.
- `.nullable()` is the normal pattern for not-found pages.

## 4. Create a binder

Framework-agnostic:

```ts
import { createBinder } from "typedrift"

export const binder = createBinder<AppServices, AppSession>({
  registry,
  getServices: async () => ({ db }),
  getSession: async (ctx) => getSession(ctx.request!),
})
```

Next.js App Router:

```ts
import { createNextBinder } from "typedrift/next"

export const binder = createNextBinder<AppServices, AppSession>({
  registry,
  getServices: async () => ({ db }),
  getSession: async (ctx) => getSession(ctx.request!),
})
```

TanStack Start:

```ts
import { createStartBinder } from "typedrift/start"

export const binder = createStartBinder<AppServices, AppSession>({
  registry,
  getServices: async () => ({ db }),
  getSession: async (ctx) => getSession(ctx.request!),
})
```

Important:

- `getServices` is required for real data access.
- `getSession` is optional, but many action and middleware patterns depend on it.
- Adapters wrap the same core binder shape, so most application code stays portable.

## 5. Bind components

```tsx
import type { InferProps } from "typedrift"

type Props = InferProps<{ post: typeof PostData }>

function PostPage({ post }: Props) {
  if (!post) return <p>Not found.</p>
  return <h1>{post.title}</h1>
}

export default binder.bind(PostPage, { post: PostData })
```

Notes:

- Bound props are resolved data, not promises or client query objects.
- Keep component bodies focused on rendering and event handling.
- Let `InferProps` derive the prop shape from the actual descriptors.
