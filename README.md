# typedrift

**A React data library that derives server queries from component data types and passes typed props to components automatically.**

No query files. No codegen. No fetch calls in components. The prop type is the contract.

---

## The problem

Every React codebase maintains a silent lie. Components know exactly what data they need, but that knowledge lives in two disconnected places — the component's prop types, and a separate fetch layer. They drift. The only way to know if they match is to run the app.

Typedrift replaces that with a single declarative contract. One declaration drives both the TypeScript type and the server execution.

---

## Install

pnpm add typedrift

Requires React 19+.

---

## Quick start

### 1. Define models

```ts
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
import { createRegistry } from "typedrift"

const registry = createRegistry<AppServices>()

registry.register(Post, {
  root: async ({ id }, ctx) =>
    ctx.services.db.post.findUnique({ where: { id } }),
  relations: {
    author: async (posts, ctx) => {
      const ids = posts.map(p => p.authorId)
      const users = await ctx.services.db.user.findMany({ where: { id: { in: ids } } })
      const byId = new Map(users.map(u => [u.id, u]))
      return new Map(posts.map(p => [p.id, byId.get(p.authorId) ?? null]))
    },
  },
})
```

### 3. Create the binder

```ts
import { createBinder } from "typedrift"

export const binder = createBinder({
  registry,
  getServices: async () => ({ db }),
})
```

### 4. Use it

```tsx
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

No useQuery. No fetch. No codegen. The type of post is exact — inferred from the view.

---

## Scope

v1 is reads-only, RSC-compatible, and runtime-agnostic.

Out of scope: mutations, subscriptions, pagination/filtering in views, client-side caching.

Read the full spec:  
[https://github.com/Itzfeminisce/typedrift/docs/v1-spec.md](https://github.com/Itzfeminisce/typedrift/docs/v1-spec.md)
---

## License

MIT
