// examples/nextjs-app-router/lib/data/post.ts
import { Post } from "../models"

export const PostData = Post.view({
  title:       true,
  body:        true,
  votes:       true,
  publishedAt: true,
  author:      { name: true, avatarUrl: true },
}, {
  cache: { ttl: 120, tags: (input) => [`post:${input.id}`] },
})
.from(({ params }) => ({ id: params["postId"]! }))
.nullable()

export const PostFeed = Post.view(
  { title: true, publishedAt: true, votes: true, author: { name: true } },
  {
    filter:   ({ searchParams }) => ({
      published: true,
      ...(searchParams["tag"] ? { tag: searchParams["tag"] as string } : {}),
    }),
    sort:     () => ({ field: "publishedAt", dir: "desc" as const }),
    paginate: ({ searchParams }) => ({
      page:    Number(searchParams["page"]) || 1,
      perPage: 20,
    }),
    cache: { ttl: 30, tags: () => ["posts:all"] },
  }
)
.list()
.from(() => ({}))

export const PostWithComments = Post.view({
  title:    true,
  votes:    true,
  author:   { name: true, avatarUrl: true },
  comments: { body: true, author: { name: true, avatarUrl: true } },
}, {
  cache: { ttl: 60, tags: (input) => [`post:${input.id}`, "comments:all"] },
})
.from(({ params }) => ({ id: params["postId"]! }))
.nullable()
