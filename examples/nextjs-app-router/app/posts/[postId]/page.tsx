// examples/nextjs-app-router/app/posts/[postId]/page.tsx
// Demonstrates: live view, useLiveData(), conditional actions, structured errors

import { binder }                         from "@/lib/binder"
import { PostWithComments }               from "@/lib/data/post"
import { votePost, addComment, deletePost } from "@/lib/actions/post"
import type { InferProps }                from "typedrift"

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = InferProps<{
  post:      typeof PostWithComments
  onVote:    typeof votePost
  onComment: typeof addComment
  onDelete:  typeof deletePost | undefined  // conditional — admin only
}>

// ── Component ─────────────────────────────────────────────────────────────────

function PostPage({ post, onVote, onComment, onDelete }: Props) {
  // Opt into live connection state
  // PostWithComments is used with .live() at bind site below
  const { stale, loading, updatedAt } = PostWithComments.useLiveData()

  if (!post) return <p className="empty">Post not found.</p>

  return (
    <article>
      {/* Live connection status */}
      {stale && (
        <div className="banner warn">
          ⚠ Live updates paused — showing last known data
        </div>
      )}

      {/* Post header */}
      <header>
        <h1>{post.title}</h1>
        <div className="meta">
          <img src={post.author.avatarUrl ?? "/avatar.png"} alt={post.author.name} />
          <span>by {post.author.name}</span>
          {updatedAt && (
            <time>· updated {updatedAt.toLocaleTimeString()}</time>
          )}
        </div>
      </header>

      {/* Vote — live counter updates automatically */}
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

      {/* Body */}
      <section className="body">{post.body}</section>

      {/* Comments — live updates when new comments arrive */}
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

        {/* Add comment form */}
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
          {onComment.fieldErrors?.body && (
            <span className="error">{onComment.fieldErrors.body}</span>
          )}
        </form>
      </section>

      {/* Admin-only actions — only rendered if session.role === "admin" */}
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

// ── Export ────────────────────────────────────────────────────────────────────

export default binder
  // .live() — component re-renders when votes or comments update
  .bind(PostPage, { post: PostWithComments.live({ staleTime: 3000 }) })
  .actions((ctx) => ({
    onVote:    votePost,
    onComment: addComment,
    // Admin-only delete — never reaches non-admin components
    ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
  }))
