# typedrift

**A React data library where the component prop type is the only declaration.**

No query files. No codegen. No fetch calls in components. Define what you need once — Typedrift derives the server execution, injects typed props, and keeps data live.

[![npm](https://img.shields.io/npm/v/typedrift)](https://npmjs.com/package/typedrift)

---

## Install

```bash
pnpm add typedrift
```

Requires React 19+ and TypeScript 5.0+.

---

## The idea

Every React codebase maintains a silent lie. The component knows exactly what data it needs, but that knowledge lives in two disconnected places — the prop types, and a separate fetch layer. They drift. The only way to know if they match is to run the app.

Typedrift makes the prop type the only declaration. One definition drives the TypeScript type and the server execution. Swap `.live()` on and the same component becomes realtime — no code change.

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
  votes:       field.number(),
  publishedAt: field.date(),
  authorId:    field.string(),
  author:      ref(User),
})
```

### 2. Register resolvers

```ts
// lib/registry.ts
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

### 3. Create a binder

```ts
// lib/binder.ts
import { createNextBinder } from "typedrift/next"   // or "typedrift/start"
import { registry } from "./registry"

export const binder = createNextBinder({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => getSession(ctx.request),
})
```

### 4. Use in a component

```tsx
// app/posts/[postId]/page.tsx
import { binder } from "@/lib/binder"
import { Post }   from "@/lib/models"
import type { InferProps } from "typedrift"

const PostData = Post.view({
  title:  true,
  votes:  true,
  author: { name: true },
})
.from(({ params }) => ({ id: params.postId! }))
.nullable()

type Props = InferProps<{ post: typeof PostData }>

function PostPage({ post }: Props) {
  if (!post) return <p>Not found.</p>
  return (
    <article>
      <h1>{post.title}</h1>
      <span>{post.votes} votes · by {post.author.name}</span>
    </article>
  )
}

export default binder.bind(PostPage, { post: PostData })
```

---

## Mutations

```ts
// lib/actions/post.ts
import { action } from "typedrift"
import { z }      from "zod"

export const votePost = action({
  input:   z.object({ id: z.string() }),
  guard:   (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    await ctx.services.db.vote.create({ data: { postId: input.id } })
    const votes = await ctx.services.db.vote.count({ where: { postId: input.id } })
    return { votes }
  },
  onSuccess: (result, input) => ({
    revalidate: [`post:${input.id}`],
  }),
})
```

```tsx
// app/posts/[postId]/page.tsx
function PostPage({ post, onVote }: Props) {
  if (!post) return <p>Not found.</p>
  return (
    <article>
      <h1>{post.title}</h1>
      <span>{post.votes} votes</span>
      <button
        onClick={() => onVote({ id: post.id })}
        disabled={onVote.pending}
      >
        {onVote.pending ? "Voting..." : "Vote"}
      </button>
      {onVote.error && <p>{onVote.error}</p>}
    </article>
  )
}

export default binder
  .bind(PostPage,  { post: PostData })
  .actions({ onVote: votePost })
```

Conditional actions — server decides what the component receives:

```tsx
export default binder
  .bind(PostPage, { post: PostData })
  .actions((ctx) => ({
    onVote:   votePost,
    ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
  }))
```

---

## Realtime

Make any view live with one method — the component is unchanged:

```tsx
// Static — fetched once at render
export default binder.bind(PostPage, { post: PostData })

// Live — SSE subscription, re-renders on every push
export default binder.bind(PostPage, { post: PostData.live() })

// Live with poll fallback (every 5s if no push arrives)
export default binder.bind(PostPage, { post: PostData.live({ interval: 5000 }) })
```

Access live connection state when you need it:

```tsx
function PostPage({ post }: Props) {
  const { stale, loading, updatedAt } = PostData.useLiveData()

  if (!post) return <p>Not found.</p>
  return (
    <article>
      {stale && <p>⚠ Reconnecting...</p>}
      <h1>{post.title}</h1>
      <span>{post.votes} votes</span>
      {updatedAt && <time>Updated {updatedAt.toLocaleTimeString()}</time>}
    </article>
  )
}

// Bind is identical — component opts into state via hook
export default binder.bind(PostPage, { post: PostData.live() })
```

The prop shape is always `{ title: string; votes: number } | null` — identical to the static case. No `post.value.title`, no wrappers.

### AI streaming

```ts
import { CLEAR } from "typedrift"

const AnalysisData = Document.view({ content: true })
  .live({
    onData: (incoming, previous, meta) => {
      // null = keep previous (mid-stream), CLEAR = reset to null
      if (!meta.done) return null
      return JSON.parse(meta.accumulated)
    },
    validate: AIOutputSchema,   // validates final shape
  })
  .from(({ params }) => ({ id: params.docId! }))
```

### Action triggers live update

```ts
export const updatePost = action({
  execute:   async (input, ctx) => ctx.services.db.post.update(...),
  onSuccess: (result) => ({
    // All live views subscribed to this tag get a push automatically
    revalidate: [`post:${result.id}`],
  }),
})
```

### SSE endpoint

The framework adapter registers `/__typedrift/live` automatically.
For explicit control:

```ts
// app/api/__typedrift/live/route.ts  (Next.js)
export const GET = binder.liveHandler()
```

### Live options

```ts
PostData.live({
  interval:  5000,                          // poll fallback ms
  enabled:   (ctx) => !!ctx.session,        // conditional subscription
  tags:      (input) => [`post:${input.id}`], // explicit subscription tags
  staleTime: 3000,                          // ms before stale: true
  reconnect: {                              // reconnection config
    attempts: 10,
    delay:    1000,
    backoff:  "exponential",
    maxDelay: 30_000,
  },
  onData:    (incoming, prev, meta) => ..., // transform / accumulate
  validate:  MySchema,                      // push validation
  maxAge:    10_000,                        // data TTL ms
  onExpire:  "refetch",                     // "stale" | "refetch" | "clear"
})
```

---

## List pages

```ts
const PostFeed = Post.view(
  { title: true, publishedAt: true, author: { name: true } },
  {
    filter:   ({ searchParams }) => ({ published: true }),
    sort:     () => ({ field: "publishedAt", dir: "desc" }),
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

## Caching

```ts
// Per-view cache config
const PostData = Post.view({ title: true }, {
  cache: { ttl: 120, tags: (input) => [`post:${input.id}`] },
})
.from(({ params }) => ({ id: params.postId! }))

// Opt out
const MyDrafts = Post.view({ title: true }, { cache: false })
  .list().from(() => ({}))
```

```ts
// Global cache on binder
createNextBinder({
  registry,
  getServices: async () => ({ db }),
  cache: { store: redisCacheStore(redis), defaultTtl: 60 },
})
```

---

## Production setup

```ts
// lib/binder.ts
import { createNextBinder }                           from "typedrift/next"
import { middleware, auditMiddleware,
         rateLimitMiddleware, redisCacheStore,
         openTelemetryTracer }                        from "typedrift"
import { trace }                                      from "@opentelemetry/api"

export const binder = createNextBinder({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => verifyJWT(ctx.request),

  cache:  { store: redisCacheStore(redis), defaultTtl: 60 },
  tracer: openTelemetryTracer(trace.getTracer("myapp")),

  middleware: [
    middleware.requireAuth(),

    rateLimitMiddleware({
      filter: "actions",
      store:  redisRateLimitStore(redis),
      window: "1m", max: 100,
      key:    (ctx) => ctx.session?.userId ?? "anon",
    }),

    auditMiddleware({
      filter:  "actions",
      redact:  (e) => ({ ...e, input: redact(e.input) }),
      onEntry: async (e, ctx) =>
        ctx.services.db.auditLog.create({ data: e }),
    }),
  ],
})
```

---

## CLI

```bash
# Validate registry completeness — exit 1 if issues found
npx typedrift check

# Watch mode — re-checks on file save
npx typedrift check --watch

# Full registry inspection
npx typedrift inspect

# Scaffold missing resolvers
npx typedrift generate --missing

# Generate a new model
npx typedrift generate --model Invoice
```

Config file:

```ts
// typedrift.config.ts
import { defineConfig } from "typedrift/cli"

export default defineConfig({
  include:  ["src/**/*.ts", "src/**/*.tsx"],
  registry: "src/lib/registry.ts",
  output:   "src/lib",
  aliases:  { "@": "src" },
})
```

CI:

```json
{ "prebuild": "typedrift check" }
```

---

## Framework adapters

```ts
import { createNextBinder }  from "typedrift/next"   // Next.js App Router
import { createStartBinder } from "typedrift/start"  // TanStack Start
import { createBinder }      from "typedrift"         // framework-agnostic
```

Same options, same middleware, same actions. One import swap between frameworks.

Thick opt-ins (both adapters):

```ts
createNextBinder({
  registry,
  getServices: async () => ({ db }),
  session: "cookie",           // reads cookies automatically
  cache:   { defaultTtl: 60 }, // Next.js: unstable_cache / Start: memoryCacheStore
})
```

---

## API reference

See full docs at https://typedrift.dev

---

## License

MIT
