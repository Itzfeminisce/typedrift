import { Post } from "./models"

export const PostDetail = Post.view({
  title:  true,
  author: { name: true },
  tags:   { name: true },
}).from(({ params }) => ({ id: params.postId }))
