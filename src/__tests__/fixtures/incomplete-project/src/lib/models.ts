import { model, field, ref } from "typedrift"

export const User = model("User", {
  id:   field.id(),
  name: field.string(),
})

export const Tag = model("Tag", {
  id:   field.id(),
  name: field.string(),
})

export const Post = model("Post", {
  id:       field.id(),
  title:    field.string(),
  authorId: field.string(),
  author:   ref(User),
  tags:     ref(Tag).list(),
})
