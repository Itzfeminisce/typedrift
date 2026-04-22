# typedrift — Next.js App Router example

Demonstrates the complete Typedrift stack on Next.js App Router.

## Local repo validation

If you wire this example or another Next.js 16 consumer app to a local Typedrift checkout with `pnpm link:`, set `turbopack.root` in the consumer app to the parent directory that contains both repos.

Without that, Turbopack will usually fail to resolve `typedrift` and `typedrift/next` because linked dependencies outside the project root are not followed by default.

If you want a simpler local setup, prefer `file:../typedrift`.

## What's shown

- `lib/models.ts` — model + field + ref definitions
- `lib/registry.ts` — resolvers via batch.one / batch.many
- `lib/binder.ts` — createNextBinder with session, cache, middleware
- `lib/data/post.ts` — view definitions (single, list, with-comments)
- `lib/actions/post.ts` — action definitions (vote, create, update, delete, comment)
- `app/posts/[postId]/page.tsx` — live view + useLiveData() + conditional actions
- `app/feed/page.tsx` — list view + create action
- `app/api/typedrift/live/route.ts` — SSE endpoint for live views

## Key patterns

### Live view + useLiveData()
```tsx
// One word — component is unchanged
export default binder.bind(PostPage, { post: PostData.live() })

// Access live state in component
const { stale, loading, updatedAt } = PostData.useLiveData()
```

### Conditional actions — server decides
```tsx
.actions((ctx) => ({
  onVote: votePost,
  ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
}))
```

### Action triggers live update
```ts
onSuccess: (result) => ({
  revalidate: [`post:${result.id}`],  // pushes to all live subscribers
})
```

## Framework-specific files

Only three files are Next.js specific:
1. `lib/binder.ts` — `createNextBinder` import
2. `app/api/typedrift/live/route.ts` — SSE route
3. Default export convention (`export default binder.bind(...)`)

Everything else is portable.
