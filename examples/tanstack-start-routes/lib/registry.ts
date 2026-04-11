import { createRegistry } from "typedrift"
import { User, Post, Comment } from "./models"

// Replace with your actual DB client
type DB = any
export type AppServices = { db: DB }

export const registry = createRegistry<AppServices>()

registry.register(Post, {
  root: async ({ id }, ctx) =>
    ctx.services.db.post.findUnique({ where: { id } }),

  relations: {
    author: async (posts, ctx) => {
      const ids = posts.map((p: any) => p.authorId)
      const users = await ctx.services.db.user.findMany({
        where: { id: { in: ids } },
      })
      const byId = new Map(users.map((u: any) => [u.id, u]))
      return new Map(posts.map((p: any) => [p.id, byId.get(p.authorId) ?? null]))
    },

    comments: async (posts, ctx) => {
      const ids = posts.map((p: any) => p.id)
      const comments = await ctx.services.db.comment.findMany({
        where: { postId: { in: ids } },
      })
      const byPost = new Map<string, any[]>()
      for (const c of comments) {
        if (!byPost.has(c.postId)) byPost.set(c.postId, [])
        byPost.get(c.postId)!.push(c)
      }
      return new Map(posts.map((p: any) => [p.id, byPost.get(p.id) ?? []]))
    },
  },
})

registry.register(User, {
  root: async ({ id }, ctx) =>
    ctx.services.db.user.findUnique({ where: { id } }),
  relations: {},
})

registry.register(Comment, {
  relations: {
    author: async (comments, ctx) => {
      const ids = comments.map((c: any) => c.authorId)
      const users = await ctx.services.db.user.findMany({
        where: { id: { in: ids } },
      })
      const byId = new Map(users.map((u: any) => [u.id, u]))
      return new Map(comments.map((c: any) => [c.id, byId.get(c.authorId) ?? null]))
    },
  },
})
