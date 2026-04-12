import { describe, it, expect, vi } from "vitest"
import { field, ref }          from "../field/index.js"
import { model }               from "../model/index.js"
import { createRegistry }      from "../registry/index.js"
import { createBinder }        from "../binder/index.js"
import { batch }               from "../batch/index.js"
import { action }              from "../action/index.js"
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
}                              from "../errors/index.js"

// ── Models ────────────────────────────────────────────────────────────────────

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

type AppSession = { userId: string; orgId: string; role: "admin" | "member" | "viewer" }
type AppServices = { db: typeof db }

const db = {
  users: [
    { id: "u1", name: "Alice", orgId: "o1" },
    { id: "u2", name: "Bob",   orgId: "o1" },
  ],
  posts: [
    { id: "p1", title: "Hello", authorId: "u1", orgId: "o1" },
    { id: "p2", title: "World", authorId: "u2", orgId: "o1" },
  ],
  created: [] as any[],
  deleted: [] as string[],
}

// ── Minimal schema shim — no Zod dependency in tests ─────────────────────────

function schema<T>(validator: (data: unknown) => T) {
  return {
    parse(data: unknown): T {
      return validator(data)
    },
  }
}

const postInputSchema = schema<{ title: string; body: string }>((data: any) => {
  if (typeof data?.title !== "string" || data.title.length < 3) {
    const err: any = new Error("Validation failed")
    err.errors = [{ path: ["title"], message: "Title must be at least 3 chars" }]
    throw err
  }
  if (typeof data?.body !== "string") {
    const err: any = new Error("Validation failed")
    err.errors = [{ path: ["body"], message: "Body is required" }]
    throw err
  }
  return { title: data.title, body: data.body }
})

const deleteInputSchema = schema<{ id: string }>((data: any) => {
  if (typeof data?.id !== "string") throw new Error("id required")
  return { id: data.id }
})

// ── Registry + binder builders ────────────────────────────────────────────────

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

function makeBinder(session?: AppSession) {
  return createBinder<AppServices, AppSession>({
    registry:    makeRegistry(),
    getServices: async () => ({ db }),
    getSession:  async () => session,
  })
}

// ── Action definitions ────────────────────────────────────────────────────────

const createPost = action<{ title: string; body: string }, { id: string }, AppServices, AppSession>({
  input:   postInputSchema,
  guard:   (_input, ctx) => !!ctx.session,
  execute: async (input, ctx) => {
    const newPost = { id: `p${Date.now()}`, ...input, authorId: ctx.session!.userId, orgId: ctx.session!.orgId }
    ctx.services.db.created.push(newPost)
    return { id: newPost.id }
  },
  onSuccess: (result) => ({ redirect: `/posts/${result.id}` }),
})

const deletePost = action<{ id: string }, void, AppServices, AppSession>({
  input:   deleteInputSchema,
  guard:   (input, ctx) => {
    const post = ctx.services.db.posts.find(p => p.id === input.id)
    return post?.authorId === ctx.session?.userId || ctx.session?.role === "admin"
  },
  execute: async (input, ctx) => {
    ctx.services.db.deleted.push(input.id)
  },
})

const noGuardAction = action<{ title: string; body: string }, { id: string }, AppServices, AppSession>({
  input:   postInputSchema,
  execute: async (input) => ({ id: "new-id" }),
})

// ── action() definition ───────────────────────────────────────────────────────

describe("action() definition", () => {
  it("creates an action descriptor with correct __type", () => {
    expect(createPost.__type).toBe("action")
  })

  it("exposes inputSchema for client-safe import", () => {
    expect(typeof createPost.inputSchema.parse).toBe("function")
  })

  it("inputSchema validates correctly", () => {
    expect(() => createPost.inputSchema.parse({ title: "ab" })).toThrow()
    expect(() => createPost.inputSchema.parse({ title: "valid title", body: "body" })).not.toThrow()
  })
})

// ── binder.actions() — standalone ────────────────────────────────────────────

describe("binder.actions() — standalone", () => {
  it("injects action as callable prop", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    const Bound = binder.actions(C, { onCreate: createPost })
    await (Bound as any)({ params: {}, searchParams: {} })

    expect(typeof received.onCreate).toBe("function")
  })

  it("action callable executes and returns result", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    const Bound = binder.actions(C, { onCreate: createPost })
    await (Bound as any)({ params: {}, searchParams: {} })

    const result = await received.onCreate({ title: "Test Post", body: "Some body content" })
    expect(result).toHaveProperty("id")
    expect(db.created).toHaveLength(1)
    expect(db.created[0]!.title).toBe("Test Post")
  })

  it("action callable has pending, error, fieldErrors, lastResult", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })

    let received: any = null
    const C = (p: any) => { received = p; return null }
    const Bound = binder.actions(C, { onCreate: createPost })
    await (Bound as any)({ params: {}, searchParams: {} })

    expect(received.onCreate.pending).toBe(false)
    expect(received.onCreate.error).toBeNull()
    expect(received.onCreate.fieldErrors).toBeNull()
    expect(received.onCreate.lastResult).toBeNull()
  })

  it("action callable updates lastResult after success", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    const Bound = binder.actions(C, { onCreate: createPost })
    await (Bound as any)({ params: {}, searchParams: {} })

    await received.onCreate({ title: "Test Post", body: "body content" })
    expect(received.onCreate.lastResult).toHaveProperty("id")
  })
})

// ── binder.bind().actions() — chained ────────────────────────────────────────

describe("binder.bind().actions() — chained", () => {
  it("injects both data props and action props", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder.bind(C, { post: PostData }).actions({ onCreate: createPost })
    await (Bound as any)({ params: {}, searchParams: {} })

    expect(received.post.title).toBe("Hello")
    expect(typeof received.onCreate).toBe("function")
  })

  it("data and actions resolve in parallel — both present", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder
      .bind(C, { post: PostData })
      .actions({ onCreate: createPost, onDelete: deletePost })
    await (Bound as any)({ params: {}, searchParams: {} })

    expect(received.post.title).toBe("Hello")
    expect(typeof received.onCreate).toBe("function")
    expect(typeof received.onDelete).toBe("function")
  })

  it("actions() with function form receives ctx", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "admin" })

    let capturedCtx: any = null
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const C = (p: any) => p

    const Bound = binder.bind(C, { post: PostData }).actions((ctx) => {
      capturedCtx = ctx
      return { onCreate: createPost }
    })
    await (Bound as any)({ params: { id: "p1" }, searchParams: {} })

    expect(capturedCtx).not.toBeNull()
    expect(capturedCtx.session?.role).toBe("admin")
    expect(capturedCtx.params.id).toBe("p1")
  })
})

// ── Conditional actions ───────────────────────────────────────────────────────

describe("conditional actions via function form", () => {
  it("includes action when condition is met", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "admin" })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder
      .bind(C, { post: PostData })
      .actions((ctx) => ({
        ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
      }))
    await (Bound as any)({ params: {}, searchParams: {} })

    expect(typeof received.onDelete).toBe("function")
  })

  it("excludes action when condition is not met", async () => {
    const binder = makeBinder({ userId: "u2", orgId: "o1", role: "member" })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder
      .bind(C, { post: PostData })
      .actions((ctx) => ({
        ...(ctx.session?.role === "admin" && { onDelete: deletePost }),
      }))
    await (Bound as any)({ params: {}, searchParams: {} })

    // member does not get delete action
    expect(received.onDelete).toBeUndefined()
  })

  it("standalone actions() also supports function form", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "viewer" })

    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder.actions(C, (ctx) => ({
      ...(ctx.session?.role !== "viewer" && { onCreate: createPost }),
    }))
    await (Bound as any)({ params: {}, searchParams: {} })

    expect(received.onCreate).toBeUndefined()
  })
})

// ── Guard ─────────────────────────────────────────────────────────────────────

describe("action guard", () => {
  it("allows execution when guard returns true", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    await received.onCreate({ title: "Valid title", body: "Valid body" })
    expect(db.created).toHaveLength(1)
  })

  it("throws ForbiddenError when guard returns false", async () => {
    // No session — guard returns false (!!ctx.session === false)
    const binder = makeBinder(undefined)

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    await expect(
      received.onCreate({ title: "Valid title", body: "Valid body" })
    ).rejects.toThrow()
    expect(received.onCreate.error).not.toBeNull()
  })

  it("action without guard always executes", async () => {
    const binder = makeBinder(undefined)

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { create: noGuardAction }) as any)({ params: {}, searchParams: {} })

    const result = await received.create({ title: "Valid title", body: "Valid body" })
    expect(result).toHaveProperty("id")
  })

  it("deletePost guard — owner can delete their own post", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.deleted = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onDelete: deletePost }) as any)({ params: {}, searchParams: {} })

    // u1 is the author of p1 — guard should pass
    await received.onDelete({ id: "p1" })
    expect(db.deleted).toContain("p1")
  })

  it("deletePost guard — non-owner non-admin cannot delete", async () => {
    // u2 trying to delete p1 (owned by u1), role is member not admin
    const binder = makeBinder({ userId: "u2", orgId: "o1", role: "member" })
    db.deleted = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onDelete: deletePost }) as any)({ params: {}, searchParams: {} })

    await expect(received.onDelete({ id: "p1" })).rejects.toThrow()
    expect(db.deleted).toHaveLength(0)
  })

  it("deletePost guard — admin can delete any post", async () => {
    const binder = makeBinder({ userId: "u2", orgId: "o1", role: "admin" })
    db.deleted = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onDelete: deletePost }) as any)({ params: {}, searchParams: {} })

    await received.onDelete({ id: "p1" })
    expect(db.deleted).toContain("p1")
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe("action input validation", () => {
  it("throws ValidationError when schema parse fails", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    // title too short — schema throws
    await expect(
      received.onCreate({ title: "ab", body: "some body" })
    ).rejects.toThrow()

    expect(received.onCreate.error).not.toBeNull()
    expect(received.onCreate.fieldErrors).toHaveProperty("title")
  })

  it("sets fieldErrors on the callable after validation failure", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    try { await received.onCreate({ title: "x", body: "body" }) } catch {}

    expect(received.onCreate.fieldErrors?.title).toBe("Title must be at least 3 chars")
  })

  it("clears error on subsequent successful call", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    // First call fails
    try { await received.onCreate({ title: "x", body: "body" }) } catch {}
    expect(received.onCreate.error).not.toBeNull()

    // Second call succeeds — error cleared
    await received.onCreate({ title: "Valid title", body: "Valid body" })
    expect(received.onCreate.error).toBeNull()
    expect(received.onCreate.fieldErrors).toBeNull()
  })
})

// ── onSuccess ─────────────────────────────────────────────────────────────────

describe("action onSuccess", () => {
  it("onSuccess redirect is stored on the callable for framework adapters", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    db.created = []

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.actions(C, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    await received.onCreate({ title: "Valid title", body: "Valid body" })

    // Redirect target is stored for the Next.js adapter (v1.0.0) to consume
    expect((received.onCreate as any).__redirect).toMatch(/^\/posts\//)
  })
})

// ── bind() returns BoundComponent with .actions() ─────────────────────────────

describe("bind() chainability", () => {
  it("bind() return value has .actions() method", () => {
    const binder = makeBinder()
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const C = (_p: any) => null
    const bound = binder.bind(C, { post: PostData })
    expect(typeof (bound as any).actions).toBe("function")
  })

  it(".actions() returns a plain ComponentType (no further chaining needed)", () => {
    const binder = makeBinder()
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const C = (_p: any) => null
    const bound = binder.bind(C, { post: PostData }).actions({ onCreate: createPost })
    // Is a function (React component)
    expect(typeof bound).toBe("function")
  })

  it("bound component (before .actions()) still works as default export", async () => {
    const binder = makeBinder({ userId: "u1", orgId: "o1", role: "member" })
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    const Bound = binder.bind(C, { post: PostData })

    // bind() alone — no actions — still works
    await (Bound as any)({ params: {}, searchParams: {} })
    expect(received.post.title).toBe("Hello")
  })
})
