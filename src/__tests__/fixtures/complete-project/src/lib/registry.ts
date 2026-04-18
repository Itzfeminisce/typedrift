import { createRegistry, batch } from "typedrift"
import { Post, User } from "./models"

const registry = createRegistry()

registry.register(Post, {
  root: async ({ id }, ctx) => ctx.services.db.posts.find(p => p.id === id) ?? null,
  relations: {
    author: batch.one("authorId", (ids, ctx) =>
      ctx.services.db.users.filter(u => ids.includes(u.id))
    ),
  },
})

registry.register(User, {
  root: async ({ id }, ctx) => ctx.services.db.users.find(u => u.id === id) ?? null,
  relations: {},
})
