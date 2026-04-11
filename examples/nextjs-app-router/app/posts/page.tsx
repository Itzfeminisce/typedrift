import { binder } from "../../lib/binder"
import { Post } from "../../lib/models"
import type { InferProps } from "typedrift"

const PostData = Post.view({
  title:       true,
  publishedAt: true,
  author: {
    name:      true,
    avatarUrl: true,
  },
})
.from(({ params }) => ({ id: params["postId"]! }))
.nullable()

type Props = InferProps<{ post: typeof PostData }>

function PostPage({ post }: Props) {
  if (!post) return <p>Post not found.</p>
  return (
    <article>
      <h1>{post.title}</h1>
      <p>by {post.author.name}</p>
      <time>{post.publishedAt.toLocaleDateString()}</time>
    </article>
  )
}

export default binder.bind(PostPage, { post: PostData })
