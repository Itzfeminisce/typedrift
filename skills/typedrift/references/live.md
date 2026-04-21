# Typedrift live views

Use this file when a task involves realtime updates, SSE, or `useLiveData()`.

## Core rule

`.live()` changes delivery, not the prop contract.

```tsx
export default binder.bind(PostPage, { post: PostData })
export default binder.bind(PostPage, { post: PostData.live() })
```

The `post` prop shape stays the same in both cases.

## Basic live binding

```tsx
export default binder.bind(PostPage, {
  post: PostData.live(),
})
```

With poll fallback:

```tsx
export default binder.bind(PostPage, {
  post: PostData.live({ interval: 5000 }),
})
```

## Live connection state

Use the descriptor hook, not a custom socket hook.

```tsx
function PostPage({ post }: Props) {
  const { stale, loading, updatedAt } = PostData.useLiveData()

  if (!post) return <p>Not found.</p>

  return (
    <>
      {stale && <p>Reconnecting...</p>}
      <h1>{post.title}</h1>
      {updatedAt && <time>{updatedAt.toLocaleTimeString()}</time>}
    </>
  )
}
```

Notes:

- `useLiveData()` is available on both static and live descriptors.
- Outside the live context it returns safe defaults.

## Revalidation after actions

Live updates commonly flow from action success tags.

```ts
export const updatePost = action({
  execute: async (input, ctx) => ctx.services.db.post.update({}),
  onSuccess: (result) => ({
    revalidate: [`post:${result.id}`],
  }),
})
```

When the bound live view subscribes to matching tags, Typedrift pushes updates automatically.

## View cache tags

```ts
export const PostData = Post.view(
  { title: true, votes: true },
  { cache: { ttl: 120, tags: (input) => [`post:${input.id}`] } }
).from(({ params }) => ({ id: params.postId! }))
```

Use stable, domain-meaningful tags so actions and live views can line up.

## SSE endpoint

Typedrift exposes `binder.liveHandler()` for the SSE route.

Next.js example:

```ts
export const GET = binder.liveHandler()
```

The default route in the examples is `app/api/__typedrift/live/route.ts`.

## AI streaming

Typedrift also supports streamed live updates with `onData` and `validate`.

```ts
const AnalysisData = Document.view({ content: true })
  .live({
    onData: (incoming, previous, meta) => {
      if (!meta.done) return null
      return JSON.parse(meta.accumulated)
    },
    validate: AIOutputSchema,
  })
```

Use this only when the existing codebase is already using Typedrift live streaming semantics. Do not replace it with ad hoc polling or a custom websocket abstraction.
