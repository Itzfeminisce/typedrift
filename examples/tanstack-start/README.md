# typedrift — TanStack Start example

Identical app to the Next.js example — demonstrates framework portability.

## What's different from the Next.js example

### 1. binder.ts — one import
```ts
// Next.js
import { createNextBinder }  from "typedrift/next"

// TanStack Start
import { createStartBinder } from "typedrift/start"
```

### 2. Route files — createFileRoute wrapper
```tsx
// Next.js
export default binder.bind(PostPage, { post: PostData.live() })

// TanStack Start
const BoundPage = binder.bind(PostPage, { post: PostData.live() })
export const Route = createFileRoute("/posts/$postId")({
  component: BoundPage,
})
```

### 3. Cache default
- Next.js: omit store → `unstable_cache`
- TanStack Start: omit store → `memoryCacheStore()` (add Redis for production)

## What is identical

- `lib/models.ts` — byte-for-byte identical
- `lib/registry.ts` — byte-for-byte identical
- `lib/data/post.ts` — byte-for-byte identical
- `lib/actions/post.ts` — byte-for-byte identical
- Component function bodies — byte-for-byte identical
- `PostData.useLiveData()` — works identically
- Conditional actions pattern — identical

That is the measure of how well the adapter abstraction works.
