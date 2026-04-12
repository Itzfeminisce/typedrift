import { describe, it, expect, vi } from "vitest"
import { field, ref }         from "../field/index.js"
import { model }              from "../model/index.js"
import { createRegistry }     from "../registry/index.js"
import { createBinder }       from "../binder/index.js"
import { batch }              from "../batch/index.js"
import { middleware }         from "../middleware/index.js"
import type { Middleware }    from "../middleware/index.js"
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  InternalError,
  isTypedriftError,
}                             from "../errors/index.js"

// ── Shared models ─────────────────────────────────────────────────────────────

const User = model("User", {
  id:    field.id(),
  name:  field.string(),
  orgId: field.string(),
})

const Post = model("Post", {
  id:       field.id(),
  title:    field.string(),
  authorId: field.string(),
  orgId:    field.string(),
  author:   ref(User),
})

// ── Session type ──────────────────────────────────────────────────────────────

type AppSession = {
  userId: string
  orgId:  string
  role:   "admin" | "member" | "viewer"
}

type AppServices = {
  db: {
    users: typeof db.users
    posts: typeof db.posts
  }
}

const db = {
  users: [
    { id: "u1", name: "Alice", orgId: "o1" },
    { id: "u2", name: "Bob",   orgId: "o2" },
  ],
  posts: [
    { id: "p1", title: "Hello", authorId: "u1", orgId: "o1" },
    { id: "p2", title: "World", authorId: "u2", orgId: "o2" },
  ],
}

// ── Registry builder ──────────────────────────────────────────────────────────

function makeRegistry() {
  const registry = createRegistry<AppServices, AppSession>()

  registry.register(Post, {
    root: async ({ id }: any, ctx) =>
      ctx.services.db.posts.find(p => p.id === id) ?? null,
    relations: {
      author: batch.one("authorId", (ids, ctx) =>
        Promise.resolve(ctx.services.db.users.filter(u => ids.includes(u.id)))
      ),
    },
  })

  registry.register(User, {
    root: async ({ id }: any, ctx) =>
      ctx.services.db.users.find(u => u.id === id) ?? null,
    relations: {},
  })

  return registry
}

function makeSession(overrides?: Partial<AppSession>): AppSession {
  return { userId: "u1", orgId: "o1", role: "admin", ...overrides }
}

// ── Structured error types ────────────────────────────────────────────────────

describe("error types", () => {
  it("NotFoundError has correct code and status", () => {
    const err = new NotFoundError("Post", "p99")
    expect(err.code).toBe("NOT_FOUND")
    expect(err.status).toBe(404)
    expect(err.message).toContain("Post")
    expect(err.message).toContain("p99")
  })

  it("ForbiddenError has correct code and status", () => {
    const err = new ForbiddenError("No access")
    expect(err.code).toBe("FORBIDDEN")
    expect(err.status).toBe(403)
    expect(err.message).toBe("No access")
  })

  it("ValidationError carries field messages", () => {
    const err = new ValidationError({ title: "Required", body: "Too short" })
    expect(err.code).toBe("VALIDATION_FAILED")
    expect(err.status).toBe(422)
    expect(err.fields.title).toBe("Required")
    expect(err.fields.body).toBe("Too short")
  })

  it("InternalError has correct code and status", () => {
    const err = new InternalError("DB connection failed")
    expect(err.code).toBe("INTERNAL")
    expect(err.status).toBe(500)
  })

  it("isTypedriftError identifies TypedriftError subclasses", () => {
    expect(isTypedriftError(new NotFoundError("Post"))).toBe(true)
    expect(isTypedriftError(new ForbiddenError())).toBe(true)
    expect(isTypedriftError(new ValidationError({}))).toBe(true)
    expect(isTypedriftError(new Error("plain"))).toBe(false)
    expect(isTypedriftError("string")).toBe(false)
    expect(isTypedriftError(null)).toBe(false)
  })

  it("toJSON() returns StructuredError shape", () => {
    const err = new NotFoundError("Post", "p1")
    const json = err.toJSON()
    expect(json).toHaveProperty("code", "NOT_FOUND")
    expect(json).toHaveProperty("status", 404)
    expect(json).toHaveProperty("message")
  })

  it("ValidationError.toJSON() includes fields", () => {
    const err  = new ValidationError({ email: "Invalid" })
    const json = err.toJSON()
    expect(json.fields).toEqual({ email: "Invalid" })
  })
})

// ── Session as first-class context ────────────────────────────────────────────

describe("getSession — session in ctx", () => {
  it("ctx.session is available in resolvers when getSession is configured", async () => {
    const registry = makeRegistry()
    let capturedSession: AppSession | undefined

    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) => {
        capturedSession = ctx.session
        return ctx.services.db.posts.find(p => p.id === id) ?? null
      },
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry: reg2,
      getServices: async () => ({ db }),
      getSession:  async () => makeSession(),
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({
      params: {}, searchParams: {},
    })

    expect(capturedSession).toBeDefined()
    expect(capturedSession?.userId).toBe("u1")
    expect(capturedSession?.role).toBe("admin")
  })

  it("ctx.session is undefined when getSession is not configured", async () => {
    const registry = makeRegistry()
    let capturedSession: unknown = "not-set"

    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) => {
        capturedSession = ctx.session
        return ctx.services.db.posts.find(p => p.id === id) ?? null
      },
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
      // no getSession
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({
      params: {}, searchParams: {},
    })

    expect(capturedSession).toBeUndefined()
  })

  it("getSession receives BindContext", async () => {
    let capturedCtx: any
    const registry = makeRegistry()
    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry: reg2,
      getServices: async () => ({ db }),
      getSession:  async (ctx) => {
        capturedCtx = ctx
        return makeSession()
      },
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({
      params: { postId: "p1" }, searchParams: { tab: "comments" },
    })

    expect(capturedCtx.params.postId).toBe("p1")
    expect(capturedCtx.searchParams.tab).toBe("comments")
  })
})

// ── Middleware ────────────────────────────────────────────────────────────────

describe("middleware stack", () => {
  it("middleware runs before resolver", async () => {
    const order: string[] = []

    const mw: Middleware<AppSession, AppServices> = async (ctx, next) => {
      order.push("before")
      const result = await next()
      order.push("after")
      return result
    }

    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) => {
        order.push("resolver")
        return ctx.services.db.posts.find(p => p.id === id) ?? null
      },
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry:    reg2,
      getServices: async () => ({ db }),
      getSession:  async () => makeSession(),
      middleware:  [mw],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({
      params: {}, searchParams: {},
    })

    expect(order).toEqual(["before", "resolver", "after"])
  })

  it("multiple middleware runs in array order", async () => {
    const order: string[] = []

    const mw1: Middleware = async (ctx, next) => {
      order.push("mw1-before")
      const r = await next()
      order.push("mw1-after")
      return r
    }
    const mw2: Middleware = async (ctx, next) => {
      order.push("mw2-before")
      const r = await next()
      order.push("mw2-after")
      return r
    }

    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) => {
        order.push("resolver")
        return ctx.services.db.posts.find(p => p.id === id) ?? null
      },
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
      middleware:  [mw1, mw2],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({
      params: {}, searchParams: {},
    })

    expect(order).toEqual(["mw1-before", "mw2-before", "resolver", "mw2-after", "mw1-after"])
  })

  it("middleware runs once per source — separate passes", async () => {
    const operations: string[] = []

    const mw: Middleware = async (ctx, next) => {
      operations.push(`${ctx.operation.type}:${ctx.operation.propKey}`)
      return next()
    }

    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })
    reg2.register(User, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.users.find(u => u.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
      middleware:  [mw],
    })

    const PostData    = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const RawResults  = binder.raw(async () => [1, 2, 3])

    await (binder.bind((_p: any) => null, {
      post:    PostData,
      numbers: RawResults,
    }) as any)({ params: {}, searchParams: {} })

    // One pass per source — view:post and raw:numbers
    expect(operations).toContain("view:post")
    expect(operations).toContain("raw:numbers")
    expect(operations).toHaveLength(2)
  })

  it("middleware receives session from getSession", async () => {
    let capturedSession: AppSession | undefined

    const mw: Middleware<AppSession, AppServices> = async (ctx, next) => {
      capturedSession = ctx.session
      return next()
    }

    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry:    reg2,
      getServices: async () => ({ db }),
      getSession:  async () => makeSession({ role: "viewer" }),
      middleware:  [mw],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({
      params: {}, searchParams: {},
    })

    expect(capturedSession?.role).toBe("viewer")
  })

  it("middleware can abort execution by throwing", async () => {
    const blockingMw: Middleware = async (_ctx, _next) => {
      throw new ForbiddenError("Blocked by middleware")
    }

    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
      middleware:  [blockingMw],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await expect(
      (binder.bind((_p: any) => null, { post: PostData }) as any)({
        params: {}, searchParams: {},
      })
    ).rejects.toThrow("Blocked by middleware")
  })
})

// ── middleware.requireAuth() ──────────────────────────────────────────────────

describe("middleware.requireAuth()", () => {
  it("passes through when session is present", async () => {
    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry:    reg2,
      getServices: async () => ({ db }),
      getSession:  async () => makeSession(),
      middleware:  [middleware.requireAuth()],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.title).toBe("Hello")
  })

  it("throws ForbiddenError when session is absent", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
      // no getSession
      middleware:  [middleware.requireAuth()],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await expect(
      (binder.bind((_p: any) => null, { post: PostData }) as any)({
        params: {}, searchParams: {},
      })
    ).rejects.toThrow("Not authenticated")
  })
})

// ── middleware.requireRole() ──────────────────────────────────────────────────

describe("middleware.requireRole()", () => {
  it("passes through when role is allowed", async () => {
    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry:    reg2,
      getServices: async () => ({ db }),
      getSession:  async () => makeSession({ role: "admin" }),
      middleware:  [middleware.requireRole(["admin", "editor"])],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })
    expect(received.post.title).toBe("Hello")
  })

  it("throws ForbiddenError when role is not in allowed list", async () => {
    const reg2 = createRegistry<AppServices, AppSession>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices, AppSession>({
      registry:    reg2,
      getServices: async () => ({ db }),
      getSession:  async () => makeSession({ role: "viewer" }),
      middleware:  [middleware.requireRole(["admin", "editor"])],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await expect(
      (binder.bind((_p: any) => null, { post: PostData }) as any)({
        params: {}, searchParams: {},
      })
    ).rejects.toThrow("viewer")
  })
})

// ── Error boundary — structured mode ─────────────────────────────────────────

describe("errorBoundary: structured", () => {
  it("returns { data, error: null } on success", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }, { errorBoundary: "structured" }) as any)({
      params: {}, searchParams: {},
    })

    expect(received.post.error).toBeNull()
    expect(received.post.data.title).toBe("Hello")
  })

  it("returns { data: null, error } when TypedriftError is thrown", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async () => { throw new NotFoundError("Post", "p99") },
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p99" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }, { errorBoundary: "structured" }) as any)({
      params: {}, searchParams: {},
    })

    expect(received.post.data).toBeNull()
    expect(received.post.error.code).toBe("NOT_FOUND")
    expect(received.post.error.status).toBe(404)
  })

  it("still throws non-TypedriftError in structured mode", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async () => { throw new Error("unexpected db crash") },
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await expect(
      (binder.bind((_p: any) => null, { post: PostData }, { errorBoundary: "structured" }) as any)({
        params: {}, searchParams: {},
      })
    ).rejects.toThrow("unexpected db crash")
  })

  it("default mode (throw) is backward compatible — no envelope", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }
    // No errorBoundary option — default "throw" mode
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    // Direct prop — no { data, error } envelope
    expect(received.post.title).toBe("Hello")
    expect(received.post).not.toHaveProperty("error")
  })

  it("structured mode with ValidationError includes fields", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async () => {
        throw new ValidationError({ title: "Too short", body: "Required" })
      },
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }, { errorBoundary: "structured" }) as any)({
      params: {}, searchParams: {},
    })

    expect(received.post.error.code).toBe("VALIDATION_FAILED")
    expect(received.post.error.fields.title).toBe("Too short")
  })

  it("multiple sources — each independently structured", async () => {
    const reg2 = createRegistry<AppServices>()
    reg2.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {},
    })

    const binder = createBinder<AppServices>({
      registry:    reg2,
      getServices: async () => ({ db }),
    })

    const GoodPost   = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const BrokenPost = Post.view({ title: true }).from(() => ({ id: "p99" }))

    // Manually register broken resolver to throw
    const reg3 = createRegistry<AppServices>()
    reg3.register(Post, {
      root: async ({ id }: any, ctx) => {
        const post = ctx.services.db.posts.find(p => p.id === id)
        if (!post) throw new NotFoundError("Post", id as string)
        return post
      },
      relations: {},
    })

    const binder3 = createBinder<AppServices>({
      registry:    reg3,
      getServices: async () => ({ db }),
    })

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder3.bind(C, {
      good:   GoodPost,
      broken: BrokenPost,
    }, { errorBoundary: "structured" }) as any)({ params: {}, searchParams: {} })

    expect(received.good.data.title).toBe("Hello")
    expect(received.good.error).toBeNull()
    expect(received.broken.data).toBeNull()
    expect(received.broken.error.code).toBe("NOT_FOUND")
  })
})
