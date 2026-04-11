import { model, field, ref } from "typedrift"

export const User = model("User", {
  id:        field.id(),
  name:      field.string(),
  avatarUrl: field.string().nullable(),
})

export const Comment = model("Comment", {
  id:        field.id(),
  body:      field.string(),
  createdAt: field.date(),
  author:    ref(User),
})

export const Post = model("Post", {
  id:          field.id(),
  title:       field.string(),
  publishedAt: field.date(),
  author:      ref(User),
  comments:    ref(Comment).list(),
})
