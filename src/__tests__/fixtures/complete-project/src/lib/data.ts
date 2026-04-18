import { Post } from "./models"

export const PostData = Post.view({ title: true, author: { name: true } })
  .from(({ params }) => ({ id: params.postId }))
  .nullable()

export const PostFeed = Post.view({ title: true }, {
  paginate: () => ({ page: 1, perPage: 10 }),
}).list().from(() => ({}))
