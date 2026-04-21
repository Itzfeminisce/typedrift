// examples/nextjs-app-router/lib/models.ts
import { model, field, ref } from "typedrift"

export const User = model("User", {
  id:        field.id(),
  name:      field.string(),
  avatarUrl: field.string().nullable(),
  orgId:     field.string(),
})

export const Comment = model("Comment", {
  id:       field.id(),
  body:     field.string(),
  postId:   field.string(),
  authorId: field.string(),
  author:   ref(User),
})

export const Post = model("Post", {
  id:          field.id(),
  title:       field.string(),
  body:        field.string(),
  votes:       field.number(),
  publishedAt: field.date(),
  authorId:    field.string(),
  orgId:       field.string(),
  author:      ref(User),
  comments:    ref(Comment).list(),
})
