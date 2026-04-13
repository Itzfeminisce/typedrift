# typedrift

**A React data library that derives server queries from component data types and passes typed props to components automatically.**

No query files. No codegen. No fetch calls in components. The prop type is the contract.

[![npm](https://img.shields.io/npm/v/typedrift)](https://npmjs.com/package/typedrift)

---

## The problem

Every React codebase maintains a silent lie. Components know exactly what data they need, but that knowledge lives in two disconnected places — the component prop types, and a separate fetch layer. They drift. The only way to know if they match is to run the app.

Typedrift makes the prop type the only declaration. One definition drives both the TypeScript type and the server execution.

---

## Install

```bash
pnpm add typedrift
```

Requires React 19+ and TypeScript 5.0+.

---

## Quick start

### 1. Define models

```ts
// lib/models.ts
import { model, field, ref } from "typedrift"

export const User = model("User", {
  id:        field.id(),
  name:      field.string(),
  avatarUrl: field.string().nullable(),
})

export const Post = model("Post", {
  id:          field.id(),
  title:       field.string(),
  publishedAt: field.date(),
  author:      ref(User),
})
```

### 2. Register resolvers

```ts
// lib/registry.ts
import { createRegistry, batch } from "typedrift"
import { User, Post } from "./models"

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
```

### 3. Create the binder

```ts
// lib/binder.ts
import { createBinder } from "typedrift"

export const binder = createBinder({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => getSession(ctx.request),
})
```

### 4. Use in components

```tsx
// app/posts/[postId]/page.tsx
import { binder } from "@/lib/binder"
import { Post } from "@/lib/models"
import type { InferProps } from "typedrift"

const PostData = Post.view({
  title: true,
  author: { name: true },
})
.from(({ params }) => ({ id: params.postId! }))
.nullable()

type Props = InferProps<{ post: typeof PostData }>

function PostPage({ post }: Props) {
  if (!post) return <p>Not found.</p>
  return <h1>{post.title} by {post.author.name}</h1>
}

export default binder.bind(PostPage, { post: PostData })
```

No `useQuery`. No fetch. No codegen. The type of `post` is exact — inferred from the view.

---

## Mutations

```ts
// lib/actions/post.ts
import { action } from "typedrift"
import { z } from "zod"

export const createPost = action({
  input:   z.object({ title: z.string().min(3), body: z.string() }),
  guard:   (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    return ctx.services.db.post.create({
      data: { ...input, authorId: ctx.session!.userId },
    })
  },
  onSuccess: (result) => ({ redirect: `/posts/${result.id}` }),
})
```

```tsx
// app/posts/new/page.tsx
export default binder.actions(NewPostPage, { onCreate: createPost })

function NewPostPage({ onCreate }: InferProps<{ onCreate: typeof createPost }>) {
  return (
    <form action={onCreate}>
      <input name="title" />
      <button disabled={onCreate.pending}>
        {onCreate.pending ? "Saving..." : "Publish"}
      </button>
      {onCreate.error && <p>{onCreate.error}</p>}
    </form>
  )
}
```

Mix reads and writes:

```tsx
export default binder
  .bind(PostPage, { post: PostData })
  .actions({ onDelete: deletePost })
```

Conditional actions — server decides what the component can do:

```tsx
export default binder
  .bind(PostPage, { post: PostData })
  .actions((ctx) => ({
    onDelete: deletePost,
    ...(ctx.session?.role === "admin" && { onPin: pinPost }),
  }))
```

---

## List pages

```ts
const PostFeed = Post.view(
  { title: true, publishedAt: true, author: { name: true } },
  {
    filter:   ({ searchParams }) => ({ published: true }),
    sort:     ({ searchParams }) => ({ field: "publishedAt", dir: "desc" }),
    paginate: ({ searchParams }) => ({
      page:    Number(searchParams.page) || 1,
      perPage: 20,
    }),
  }
)
.list()
.from(() => ({}))

// Props: { posts: { data: Post[], total: number | null, page: number, perPage: number } }
```

---

## Production setup

```ts
import { createBinder, middleware, auditMiddleware,
         rateLimitMiddleware, memoryCacheStore,
         openTelemetryTracer } from "typedrift"
import { trace } from "@opentelemetry/api"

export const binder = createBinder({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => getSession(ctx.request),

  // Read caching
  cache: {
    store:      redisCacheStore(redis),
    defaultTtl: 60,
  },

  // Distributed tracing
  tracer: openTelemetryTracer(trace.getTracer("myapp")),

  // Middleware — runs once per source, in order
  middleware: [
    middleware.requireAuth(),

    rateLimitMiddleware({
      filter: "actions",
      store:  redisRateLimitStore(redis),
      window: "1m",
      max:    100,
      key:    (ctx) => ctx.session?.userId ?? "anon",
    }),

    auditMiddleware({
      filter:  "actions",
      redact:  (entry) => ({ ...entry, input: redactSensitive(entry.input) }),
      onEntry: async (entry, ctx) => {
        await ctx.services.db.auditLog.create({ data: entry })
      },
    }),
  ],
})
```

---

## API reference

See the full API reference and guides at https://typedrift.dev

---

## Scope

Typedrift v1.0.0 is reads + writes, RSC-compatible, and runtime-agnostic.

**In scope:** model/view/bind/actions, batch resolvers, middleware, caching, telemetry, structured errors.

**Out of scope:** ORM adapters, framework adapters, realtime, subscriptions.
These ship as separate packages with their own versioning.

---

## Why not Relay, tRPC, or TanStack Query?

**Relay** colocates data requirements via GraphQL fragments — closest to Typedrift. But Relay still requires GraphQL documents, a compiler, and GraphQL vocabulary. Typedrift eliminates all three.

**tRPC** gives end-to-end typed procedure calls. The unit of abstraction is a named procedure, not the component prop type. You still decide what to call and where.

**TanStack Query** is a cache and async state manager around explicit query keys. That is the opposite of Typedrift's thesis.

---

## License

MIT
