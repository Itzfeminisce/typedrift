// examples/nextjs-app-router/app/feed/page.tsx
// Demonstrates: list view, query args from searchParams, create action

import { binder }       from "@/lib/binder"
import { PostFeed }     from "@/lib/data/post"
import { createPost }   from "@/lib/actions/post"
import type { InferProps } from "typedrift"

type Props = InferProps<{
  posts:    typeof PostFeed
  onCreate: typeof createPost
}>

function FeedPage({ posts, onCreate }: Props) {
  return (
    <main>
      <header>
        <h1>Posts</h1>
        <span>{posts.total ?? "?"} total</span>
      </header>

      {/* Create post form */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const fd    = new FormData(e.currentTarget)
          const title = fd.get("title") as string
          const body  = fd.get("body")  as string
          onCreate({ title, body })
        }}
      >
        <input  name="title" placeholder="Title" required />
        <textarea name="body" placeholder="Body" required />
        <button type="submit" disabled={onCreate.pending}>
          {onCreate.pending ? "Publishing…" : "Publish"}
        </button>
        {onCreate.fieldErrors?.title && <span>{onCreate.fieldErrors.title}</span>}
        {onCreate.fieldErrors?.body  && <span>{onCreate.fieldErrors.body}</span>}
      </form>

      {/* Feed */}
      <ul>
        {posts.data.map((post) => (
          <li key={post.id}>
            <a href={`/posts/${post.id}`}>
              <h2>{post.title}</h2>
              <span>▲ {post.votes} · by {post.author.name}</span>
              <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
            </a>
          </li>
        ))}
      </ul>

      {/* Pagination */}
      <nav>
        {posts.page > 1 && (
          <a href={`?page=${posts.page - 1}`}>← Previous</a>
        )}
        <span>Page {posts.page}</span>
        {posts.data.length === 20 && (
          <a href={`?page=${posts.page + 1}`}>Next →</a>
        )}
      </nav>
    </main>
  )
}

export default binder
  .bind(FeedPage, { posts: PostFeed })
  .actions({ onCreate: createPost })
