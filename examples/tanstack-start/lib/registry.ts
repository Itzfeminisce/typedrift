// examples/nextjs-app-router/lib/registry.ts
import { createRegistry, batch } from "typedrift"
import { Post, User, Comment }   from "./models"
import type { AppServices, AppSession } from "./types"

export const registry = createRegistry<AppServices, AppSession>()

// ── Post ──────────────────────────────────────────────────────────────────────

registry.register(Post, {
  root: async ({ id }, ctx) =>
    ctx.services.db.post.findUnique({ where: { id } }),

  relations: {
    author: batch.one("authorId", (ids, ctx) =>
      ctx.services.db.user.findMany({ where: { id: { in: ids } } })
    ),
    comments: batch.many("postId", (ids, ctx) =>
      ctx.services.db.comment.findMany({
        where:   { postId: { in: ids } },
        orderBy: { createdAt: "desc" },
      })
    ),
  },
})

// ── User ──────────────────────────────────────────────────────────────────────

registry.register(User, {
  root: async ({ id }, ctx) =>
    ctx.services.db.user.findUnique({ where: { id } }),
  relations: {},
})

// ── Comment ───────────────────────────────────────────────────────────────────

registry.register(Comment, {
  root: async ({ id }, ctx) =>
    ctx.services.db.comment.findUnique({ where: { id } }),
  relations: {
    author: batch.one("authorId", (ids, ctx) =>
      ctx.services.db.user.findMany({ where: { id: { in: ids } } })
    ),
  },
})
