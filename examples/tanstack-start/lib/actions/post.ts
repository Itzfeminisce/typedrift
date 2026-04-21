// examples/nextjs-app-router/lib/actions/post.ts
import { action } from "typedrift"
import { z }      from "zod"

// ── Vote ──────────────────────────────────────────────────────────────────────

export const votePost = action({
  input:   z.object({ id: z.string() }),
  guard:   (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    await ctx.services.db.vote.create({
      data: { postId: input.id, userId: ctx.session!.userId },
    })
    const votes = await ctx.services.db.vote.count({
      where: { postId: input.id },
    })
    return { votes }
  },
  onSuccess: (_result, input) => ({
    // All live views subscribed to post:id get a push
    revalidate: [`post:${input.id}`],
  }),
})

// ── Create ────────────────────────────────────────────────────────────────────

export const createPost = action({
  input:   z.object({ title: z.string().min(3), body: z.string().min(10) }),
  guard:   (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    const post = await ctx.services.db.post.create({
      data: {
        ...input,
        authorId: ctx.session!.userId,
        orgId:    ctx.session!.orgId,
      },
    })
    return { id: post.id }
  },
  onSuccess: (result) => ({
    redirect:   `/posts/${result.id}`,
    revalidate: ["posts:all"],
  }),
})

// ── Update ────────────────────────────────────────────────────────────────────

export const updatePost = action({
  input:   z.object({ id: z.string(), title: z.string().min(3), body: z.string() }),
  guard:   (input, ctx) => {
    // Only the author or admin can update
    return ctx.session?.role === "admin" ||
           ctx.session?.userId === input.id  // simplified — real check would query DB
  },
  execute: async (input, ctx) => {
    const { id, ...data } = input
    return ctx.services.db.post.update({ where: { id }, data })
  },
  onSuccess: (result) => ({
    revalidate: [`post:${result.id}`, "posts:all"],
  }),
})

// ── Delete ────────────────────────────────────────────────────────────────────

export const deletePost = action({
  input:   z.object({ id: z.string() }),
  guard:   (_input, ctx) => ctx.session?.role === "admin",
  execute: async (input, ctx) => {
    await ctx.services.db.post.delete({ where: { id: input.id } })
  },
  onSuccess: () => ({
    redirect:   "/feed",
    revalidate: ["posts:all"],
  }),
})

// ── Add comment ───────────────────────────────────────────────────────────────

export const addComment = action({
  input:   z.object({ postId: z.string(), body: z.string().min(1) }),
  guard:   (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    return ctx.services.db.comment.create({
      data: { ...input, authorId: ctx.session!.userId },
    })
  },
  onSuccess: (_result, input) => ({
    revalidate: [`post:${input.postId}`, "comments:all"],
  }),
})
