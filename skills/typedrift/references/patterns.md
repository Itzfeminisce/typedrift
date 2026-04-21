# Typedrift patterns

Use this file for common implementation patterns beyond the setup path.

## `batch.one`

Use when the parent row stores the foreign key.

```ts
relations: {
  author: batch.one("authorId", (ids, ctx) =>
    ctx.services.db.user.findMany({ where: { id: { in: ids } } })
  ),
}
```

Typical shape: `Post.author -> User`.

## `batch.many`

Use when the child rows point back to the parent.

```ts
relations: {
  comments: batch.many("postId", (ids, ctx) =>
    ctx.services.db.comment.findMany({ where: { postId: { in: ids } } })
  ),
}
```

Typical shape: `Post.comments -> Comment[]`.

## `batch.junction`

Use for many-to-many relations through a join table.

```ts
relations: {
  tags: batch.junction({
    parentKey: "postId",
    childKey: "tagId",
    through: async (postIds, ctx) =>
      ctx.services.db.postTag.findMany({ where: { postId: { in: postIds } } }),
    target: async (tagIds, ctx) =>
      ctx.services.db.tag.findMany({ where: { id: { in: tagIds } } }),
  }),
}
```

Use this instead of stitching arrays together manually in the component.

## Nullable detail views

```ts
export const PostData = Post.view({
  title: true,
  votes: true,
})
.from(({ params }) => ({ id: params.postId! }))
.nullable()
```

Use `.nullable()` when the root lookup may legitimately miss.

## Feed or list views

```ts
export const PostFeed = Post.view({
  id: true,
  title: true,
  votes: true,
  author: { name: true },
})
.from(() => ({ published: true }))
```

The component should receive ready-to-render items, not fetch state.

## Actions

```ts
import { action } from "typedrift"
import { z } from "zod"

export const createPost = action({
  input: z.object({
    title: z.string(),
    body: z.string(),
  }),
  guard: (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    return ctx.services.db.post.create({ data: input })
  },
  onSuccess: (result) => ({
    revalidate: ["posts:all", `post:${result.id}`],
  }),
})
```

Guidance:

- Use `guard` for per-action authorization.
- Return `revalidate` tags from `onSuccess` when writes should refresh cached or live readers.

## Chained `.actions(...)`

Attach actions after `bind()` when the page combines reads and writes.

```tsx
const BoundPage = binder
  .bind(FeedPage, { posts: PostFeed })
  .actions({ onCreate: createPost })
```

This is the common route/page pattern.

## Conditional action maps

Use the function form when the server should decide which actions the component receives.

```tsx
export default binder
  .bind(PostPage, { post: PostData })
  .actions((ctx) => ({
    onVote: votePost,
    ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
  }))
```

Do not flatten this into a client-side role check if the current code intentionally decides on the server.

## Standalone `binder.actions(...)`

Use this when a component only needs mutation props.

```tsx
export default binder.actions(NewPostPage, { onCreate: createPost })
```

## Inference pattern

Prefer deriving props from descriptors instead of rewriting the shape manually.

```ts
type Props = InferProps<{
  post: typeof PostData
  onVote: typeof votePost
}>
```

That keeps action status and view types aligned with the actual source objects.
