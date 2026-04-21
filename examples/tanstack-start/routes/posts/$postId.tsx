// examples/tanstack-start/routes/posts/$postId.tsx
// Demonstrates: identical component to Next.js, createFileRoute wrapper is the only diff

import { createFileRoute }                from "@tanstack/react-router"
import { binder }                         from "~/lib/binder"
import { PostWithComments }               from "~/lib/data/post"
import { votePost, addComment, deletePost } from "~/lib/actions/post"
import type { InferProps }                from "typedrift"

// ── Types — identical to Next.js example ──────────────────────────────────────

type Props = InferProps<{
  post:      typeof PostWithComments
  onVote:    typeof votePost
  onComment: typeof addComment
  onDelete:  typeof deletePost | undefined
}>

// ── Component — identical to Next.js example ──────────────────────────────────

function PostPage({ post, onVote, onComment, onDelete }: Props) {
  const { stale, loading, updatedAt } = PostWithComments.useLiveData()

  if (!post) return <p className="empty">Post not found.</p>

  return (
    <article>
      {stale && (
        <div className="banner warn">
          ⚠ Live updates paused — showing last known data
        </div>
      )}

      <header>
        <h1>{post.title}</h1>
        <div className="meta">
          <img src={post.author.avatarUrl ?? "/avatar.png"} alt={post.author.name} />
          <span>by {post.author.name}</span>
          {updatedAt && <time>· updated {updatedAt.toLocaleTimeString()}</time>}
        </div>
      </header>

      <div className="vote-bar">
        <span className="vote-count">{post.votes} votes</span>
        <button
          onClick={() => onVote({ id: post.id })}
          disabled={onVote.pending || loading}
        >
          {onVote.pending ? "Voting…" : "▲ Vote"}
        </button>
        {onVote.error && <span className="error">{onVote.error}</span>}
      </div>

      <section className="body">{post.body}</section>

      <section className="comments">
        <h2>{post.comments.length} Comments</h2>
        {post.comments.map((c) => (
          <div key={c.id} className="comment">
            <img src={c.author.avatarUrl ?? "/avatar.png"} alt={c.author.name} />
            <div>
              <strong>{c.author.name}</strong>
              <p>{c.body}</p>
            </div>
          </div>
        ))}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const body = (e.currentTarget.elements.namedItem("body") as HTMLTextAreaElement).value
            onComment({ postId: post.id, body })
          }}
        >
          <textarea name="body" placeholder="Add a comment…" required />
          <button type="submit" disabled={onComment.pending}>
            {onComment.pending ? "Posting…" : "Post"}
          </button>
        </form>
      </section>

      {onDelete && (
        <footer className="admin-actions">
          <button
            className="danger"
            onClick={() => onDelete({ id: post.id })}
            disabled={onDelete.pending}
          >
            {onDelete.pending ? "Deleting…" : "Delete post"}
          </button>
        </footer>
      )}
    </article>
  )
}

// ── Bound component — identical logic to Next.js ──────────────────────────────

const BoundPage = binder
  .bind(PostPage, { post: PostWithComments.live({ staleTime: 3000 }) })
  .actions((ctx) => ({
    onVote:    votePost,
    onComment: addComment,
    ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
  }))

// ── TanStack Router wrapper — the only difference from Next.js ────────────────

export const Route = createFileRoute("/posts/$postId")({
  component: BoundPage,
})
