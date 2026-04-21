// examples/tanstack-start/routes/feed.tsx

import { createFileRoute } from "@tanstack/react-router"
import { binder }          from "~/lib/binder"
import { PostFeed }        from "~/lib/data/post"
import { createPost }      from "~/lib/actions/post"
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

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          onCreate({ title: fd.get("title") as string, body: fd.get("body") as string })
        }}
      >
        <input    name="title" placeholder="Title" required />
        <textarea name="body"  placeholder="Body"  required />
        <button type="submit" disabled={onCreate.pending}>
          {onCreate.pending ? "Publishing…" : "Publish"}
        </button>
      </form>

      <ul>
        {posts.data.map((post) => (
          <li key={post.id}>
            <a href={`/posts/${post.id}`}>
              <h2>{post.title}</h2>
              <span>▲ {post.votes} · by {post.author.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}

const BoundPage = binder
  .bind(FeedPage, { posts: PostFeed })
  .actions({ onCreate: createPost })

export const Route = createFileRoute("/feed")({
  component: BoundPage,
})
