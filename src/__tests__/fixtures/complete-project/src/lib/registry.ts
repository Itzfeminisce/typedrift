import { createRegistry, batch } from "typedrift"
import { Post, User } from "./models"

type AppServices = {
  db: {
    posts: Array<{ id: string; title: string; authorId: string }>
    users: Array<{ id: string; name: string }>
  }
}

const registry = createRegistry<AppServices>()

registry.register(Post, {
  root: async ({ id }, ctx) => ctx.services.db.posts.find((p) => p.id === id) ?? null,
  relations: {
    author: batch.one("authorId", (ids, ctx) =>
      Promise.resolve(ctx.services.db.users.filter((u) => ids.includes(u.id)))
    ),
  },
})

registry.register(User, {
  root: async ({ id }, ctx) => ctx.services.db.users.find((u) => u.id === id) ?? null,
  relations: {},
})
