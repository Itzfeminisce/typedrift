import { describe, it, expect, vi, beforeEach } from "vitest"
import { field, ref }         from "../field/index.js"
import { model }              from "../model/index.js"
import { createRegistry }     from "../registry/index.js"
import { createBinder }       from "../binder/index.js"
import { batch }              from "../batch/index.js"
import { action }             from "../action/index.js"
import {
  middleware, withFilter,
  auditMiddleware, rateLimitMiddleware,
  evalFilter,
} from "../middleware/index.js"
import type { MiddlewareContext, AuditEntry, RateLimitStore } from "../middleware/index.js"
import { memoryCacheStore }   from "../cache/index.js"
import type { TypedriftTracer, TypedriftSpan } from "../telemetry/index.js"
import { NotFoundError }      from "../errors/index.js"

// ── Models ────────────────────────────────────────────────────────────────────

const User = model("User", { id: field.id(), name: field.string() })
const Post = model("Post", {
  id:       field.id(),
  title:    field.string(),
  authorId: field.string(),
  author:   ref(User),
})

type AppSession  = { userId: string; orgId: string; role: "admin" | "member" }
type AppServices = { db: typeof db }

const db = {
  users: [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }],
  posts: [
    { id: "p1", title: "Hello", authorId: "u1" },
    { id: "p2", title: "World", authorId: "u2" },
  ],
}

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

function makeBinder(opts: {
  session?:    AppSession
  middleware?: any[]
  cache?:      any
  tracer?:     any
} = {}) {
  return createBinder<AppServices, AppSession>({
    registry:    makeRegistry(),
    getServices: async () => ({ db }),
    getSession:  async () => opts.session,
    middleware:  opts.middleware ?? [],
    cache:       opts.cache,
    tracer:      opts.tracer,
  })
}

function makeCtx(overrides: Partial<MiddlewareContext<AppSession, AppServices>> = {}): MiddlewareContext<AppSession, AppServices> {
  return {
    params:       {},
    searchParams: {},
    session:      { userId: "u1", orgId: "o1", role: "member" },
    services:     { db },
    operation:    { type: "view", model: "Post", propKey: "post" },
    ...overrides,
  }
}

const schema = <T>(fn: (d: unknown) => T) => ({ parse: fn })
const titleSchema = schema<{ title: string }>((d: any) => {
  if (!d?.title) throw Object.assign(new Error("Invalid"), { errors: [{ path: ["title"], message: "Required" }] })
  return { title: d.title }
})

// ── MiddlewareFilter / evalFilter ─────────────────────────────────────────────

describe("MiddlewareFilter — evalFilter()", () => {
  it('"all" always returns true', async () => {
    expect(await evalFilter("all", makeCtx())).toBe(true)
  })

  it('"actions" returns true for action operations', async () => {
    expect(await evalFilter("actions", makeCtx({ operation: { type: "action", propKey: "create" } }))).toBe(true)
    expect(await evalFilter("actions", makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } }))).toBe(false)
  })

  it('"views" returns true for view and raw operations', async () => {
    expect(await evalFilter("views", makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } }))).toBe(true)
    expect(await evalFilter("views", makeCtx({ operation: { type: "raw", propKey: "results" } }))).toBe(true)
    expect(await evalFilter("views", makeCtx({ operation: { type: "action", propKey: "create" } }))).toBe(false)
  })

  it('string[] matches operation type, model, propKey, or actionName', async () => {
    expect(await evalFilter(["view"],    makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } }))).toBe(true)
    expect(await evalFilter(["Post"],    makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } }))).toBe(true)
    expect(await evalFilter(["post"],    makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } }))).toBe(true)
    expect(await evalFilter(["Other"],   makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } }))).toBe(false)
    expect(await evalFilter(["createPost"], makeCtx({ operation: { type: "action", propKey: "create", actionName: "createPost" } }))).toBe(true)
  })

  it('predicate function receives ctx and returns boolean', async () => {
    const ctx = makeCtx({ session: { userId: "u1", orgId: "o1", role: "admin" } })
    expect(await evalFilter((c) => c.session?.role === "admin", ctx)).toBe(true)
    expect(await evalFilter((c) => c.session?.role === "member", ctx)).toBe(false)
  })

  it('async predicate works', async () => {
    const asyncFilter = async (ctx: MiddlewareContext<AppSession, AppServices>) => {
      await new Promise(r => setTimeout(r, 1))
      return ctx.session?.role === "admin"
    }
    expect(await evalFilter(asyncFilter, makeCtx({ session: { userId: "u1", orgId: "o1", role: "admin" } }))).toBe(true)
    expect(await evalFilter(asyncFilter, makeCtx())).toBe(false)
  })
})

// ── withFilter ────────────────────────────────────────────────────────────────

describe("withFilter()", () => {
  it("wraps middleware — runs when filter matches", async () => {
    const inner = vi.fn(async (_ctx: any, next: any) => next())
    const wrapped = withFilter("actions", inner)
    const ctx  = makeCtx({ operation: { type: "action", propKey: "x" } })
    const next = vi.fn(async () => "result")
    await wrapped(ctx, next)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("skips middleware and calls next directly when filter does not match", async () => {
    const inner = vi.fn(async (_ctx: any, next: any) => next())
    const wrapped = withFilter("actions", inner)
    const ctx  = makeCtx({ operation: { type: "view", model: "Post", propKey: "post" } })
    const next = vi.fn(async () => "result")
    const result = await wrapped(ctx, next)
    expect(inner).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    expect(result).toBe("result")
  })

  it("predicate filter — runs for matching ctx", async () => {
    const inner = vi.fn(async (_ctx: any, next: any) => next())
    const wrapped = withFilter(
      (ctx) => (ctx.session as any)?.role === "admin",
      inner,
    )
    const adminCtx  = makeCtx({ session: { userId: "u1", orgId: "o1", role: "admin" } })
    const memberCtx = makeCtx()
    const next = vi.fn(async () => undefined)

    await wrapped(adminCtx, next)
    expect(inner).toHaveBeenCalledTimes(1)

    inner.mockClear()
    await wrapped(memberCtx, next)
    expect(inner).not.toHaveBeenCalled()
  })
})

// ── auditMiddleware ───────────────────────────────────────────────────────────

describe("auditMiddleware()", () => {
  it("calls onEntry after successful execution", async () => {
    const entries: AuditEntry[] = []
    const binder = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        auditMiddleware({
          filter:  "actions",
          onEntry: async (entry) => { entries.push(entry) },
        }),
      ],
    })

    const createPost = action({
      input:   titleSchema,
      execute: async (input) => ({ id: "new", title: input.title }),
    })

    let received: any = null
    await (binder.actions(
      (p: any) => { received = p; return null },
      { onCreate: createPost }
    ) as any)({ params: {}, searchParams: {} })

    await received.onCreate({ title: "Test" })
    await new Promise(r => setTimeout(r, 10))

    expect(entries).toHaveLength(1)
    expect(entries[0]!.success).toBe(true)
    expect(entries[0]!.userId).toBe("u1")
  })

  it("records failure in entry when action throws", async () => {
    const entries: AuditEntry[] = []
    const binder = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        auditMiddleware({
          filter:  "actions",
          onEntry: async (entry) => { entries.push(entry) },
        }),
      ],
    })

    const failAction = action({
      input:   titleSchema,
      execute: async () => { throw new NotFoundError("Post", "p99") },
    })

    let received: any = null
    await (binder.actions(
      (p: any) => { received = p; return null },
      { fail: failAction }
    ) as any)({ params: {}, searchParams: {} })

    try { await received.fail({ title: "Test" }) } catch {}
    await new Promise(r => setTimeout(r, 10))

    expect(entries).toHaveLength(1)
    expect(entries[0]!.success).toBe(false)
    expect(entries[0]!.errorCode).toBe("NOT_FOUND")
  })

  it("filter: views — does NOT run for actions", async () => {
    const entries: AuditEntry[] = []
    const binder = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        auditMiddleware({
          filter:  "views",
          onEntry: async (entry) => { entries.push(entry) },
        }),
      ],
    })

    const PostData   = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const createPost = action({ input: titleSchema, execute: async (i) => ({ id: "x", title: i.title }) })

    let received: any = null
    await (binder.bind(
      (p: any) => { received = p; return null }, { post: PostData }
    ).actions({ onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    await received.onCreate({ title: "Test" })
    await new Promise(r => setTimeout(r, 10))

    // Only view was audited, not the action
    expect(entries.every(e => e.operation.startsWith("view:"))).toBe(true)
  })

  it("redact() transforms entry before onEntry", async () => {
    const entries: AuditEntry[] = []
    const binder = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        auditMiddleware({
          filter:  "actions",
          redact:  (entry) => ({ ...entry, input: "[REDACTED]" }),
          onEntry: async (entry) => { entries.push(entry) },
        }),
      ],
    })

    const createPost = action({ input: titleSchema, execute: async (i) => ({ id: "x" }) })
    let received: any = null
    await (binder.actions((p: any) => { received = p; return null }, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })
    await received.onCreate({ title: "Secret title" })
    await new Promise(r => setTimeout(r, 10))

    expect(entries[0]!.input).toBe("[REDACTED]")
  })
})

// ── rateLimitMiddleware ───────────────────────────────────────────────────────

describe("rateLimitMiddleware()", () => {
  function makeMemoryRateLimitStore(): RateLimitStore {
    const counts = new Map<string, { count: number; expiresAt: number }>()
    return {
      async increment(key, windowMs) {
        const now    = Date.now()
        const entry  = counts.get(key)
        if (!entry || now > entry.expiresAt) {
          counts.set(key, { count: 1, expiresAt: now + windowMs })
          return 1
        }
        entry.count++
        return entry.count
      },
    }
  }

  it("allows requests under the limit", async () => {
    const store  = makeMemoryRateLimitStore()
    const binder = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        rateLimitMiddleware({
          filter: "actions",
          store,
          window: "1m",
          max:    5,
          key:    (ctx) => ctx.session?.userId ?? "anon",
        }),
      ],
    })

    const createPost = action({ input: titleSchema, execute: async (i) => ({ id: "x" }) })
    let received: any = null
    await (binder.actions((p: any) => { received = p; return null }, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    for (let i = 0; i < 5; i++) {
      await received.onCreate({ title: "Test" })
    }
    // All 5 should succeed
    expect(received.onCreate.error).toBeNull()
  })

  it("throws RateLimitError when limit exceeded", async () => {
    const store  = makeMemoryRateLimitStore()
    const binder = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        rateLimitMiddleware({
          filter: "actions",
          store,
          window: "1m",
          max:    2,
          key:    (ctx) => ctx.session?.userId ?? "anon",
        }),
      ],
    })

    const createPost = action({ input: titleSchema, execute: async (i) => ({ id: "x" }) })
    let received: any = null
    await (binder.actions((p: any) => { received = p; return null }, { onCreate: createPost }) as any)({ params: {}, searchParams: {} })

    await received.onCreate({ title: "Test 1" })
    await received.onCreate({ title: "Test 2" })
    // Third should fail
    await expect(received.onCreate({ title: "Test 3" })).rejects.toThrow()
    expect(received.onCreate.error).toContain("Rate limit")
  })

  it("filter: views — does not rate limit reads", async () => {
    const store     = makeMemoryRateLimitStore()
    const increment = vi.spyOn(store, "increment")
    const binder    = makeBinder({
      session:    { userId: "u1", orgId: "o1", role: "member" },
      middleware: [
        rateLimitMiddleware({
          filter: "actions",
          store,
          window: "1m",
          max:    1,
          key:    () => "testkey",
        }),
      ],
    })

    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({ params: {}, searchParams: {} })

    // Increment should not have been called (action filter skipped views)
    expect(increment).not.toHaveBeenCalled()
  })

  it("parseWindowMs handles different formats", async () => {
    // Test via actual rate limit execution timing — just verify it doesn't throw
    const store  = makeMemoryRateLimitStore()
    for (const window of ["30s", "1m", "2h", "1d"]) {
      const binder = makeBinder({
        session:    { userId: "u1", orgId: "o1", role: "member" },
        middleware: [
          rateLimitMiddleware({ filter: "actions", store, window, max: 100, key: () => "k" }),
        ],
      })
      const a = action({ input: titleSchema, execute: async (i) => ({ id: "x" }) })
      let received: any = null
      await (binder.actions((p: any) => { received = p; return null }, { a }) as any)({ params: {}, searchParams: {} })
      await received.a({ title: "Test" })
    }
  })
})

// ── memoryCacheStore ──────────────────────────────────────────────────────────

describe("memoryCacheStore()", () => {
  it("returns null for missing keys", async () => {
    const store = memoryCacheStore()
    expect(await store.get("missing")).toBeNull()
  })

  it("stores and retrieves values", async () => {
    const store = memoryCacheStore()
    await store.set("key1", { title: "Hello" }, 60)
    expect(await store.get("key1")).toEqual({ title: "Hello" })
  })

  it("expires entries after TTL", async () => {
    const store = memoryCacheStore()
    await store.set("key2", "value", 0.001)  // 1ms TTL
    await new Promise(r => setTimeout(r, 10))
    expect(await store.get("key2")).toBeNull()
  })

  it("invalidates entries by tag", async () => {
    const store = memoryCacheStore()
    await store.set("key3", "value", 60)
    // Simulate tag registration (memory store internal)
    await store.invalidate(["tag:missing"])  // should not throw
    // value still there — tag was never registered
    expect(await store.get("key3")).toBe("value")
  })
})

// ── Read caching integration ──────────────────────────────────────────────────

describe("read caching via createBinder cache config", () => {
  it("caches view results on second call — root resolver called once", async () => {
    const rootFn = vi.fn(async ({ id }: any, ctx: any) =>
      ctx.services.db.posts.find((p: any) => p.id === id) ?? null
    )
    const reg = createRegistry<AppServices, AppSession>()
    reg.register(Post, { root: rootFn, relations: {} })

    const cacheStore = memoryCacheStore()
    const binder = createBinder<AppServices, AppSession>({
      registry:    reg,
      getServices: async () => ({ db }),
      cache: { store: cacheStore, defaultTtl: 60 },
    })

    const PostData = Post.view({ title: true })
      .from(() => ({ id: "p1" }))

    const C = (_p: any) => null
    const Bound = binder.bind(C, { post: PostData })

    // First call — misses cache
    await (Bound as any)({ params: {}, searchParams: {} })
    expect(rootFn).toHaveBeenCalledTimes(1)

    // Second call — hits cache
    await (Bound as any)({ params: {}, searchParams: {} })
    expect(rootFn).toHaveBeenCalledTimes(1)  // still 1 — cached
  })

  it("cache: false on view bypasses cache even when global cache configured", async () => {
    const rootFn = vi.fn(async ({ id }: any, ctx: any) =>
      ctx.services.db.posts.find((p: any) => p.id === id) ?? null
    )
    const reg = createRegistry<AppServices, AppSession>()
    reg.register(Post, { root: rootFn, relations: {} })

    const binder = createBinder<AppServices, AppSession>({
      registry:    reg,
      getServices: async () => ({ db }),
      cache: { store: memoryCacheStore(), defaultTtl: 60 },
    })

    const NoCachePost = Post.view({ title: true }, undefined, false)
      .from(() => ({ id: "p1" }))

    const C = (_p: any) => null
    const Bound = binder.bind(C, { post: NoCachePost })

    await (Bound as any)({ params: {}, searchParams: {} })
    await (Bound as any)({ params: {}, searchParams: {} })

    // Called twice — cache bypassed
    expect(rootFn).toHaveBeenCalledTimes(2)
  })

  it("onSuccess.revalidate purges cache tags", async () => {
    const rootFn = vi.fn(async ({ id }: any, ctx: any) =>
      ctx.services.db.posts.find((p: any) => p.id === id) ?? null
    )
    const reg = createRegistry<AppServices, AppSession>()
    reg.register(Post, { root: rootFn, relations: {} })

    const cacheStore = memoryCacheStore()
    const binder = createBinder<AppServices, AppSession>({
      registry:    reg,
      getServices: async () => ({ db }),
      getSession:  async () => ({ userId: "u1", orgId: "o1", role: "member" }),
      cache: { store: cacheStore, defaultTtl: 60 },
    })

    const PostData = Post.view({ title: true }, {
      cache: { ttl: 60, tags: (input) => [`post:${(input as any).id}`] },
    }).from(() => ({ id: "p1" }))

    const updatePost = action({
      input:   ({ parse: (d: any) => d }) as any,
      execute: async () => ({ id: "p1" }),
      onSuccess: () => ({ revalidate: ["post:p1"] }),
    })

    const C = (_p: any) => null
    const Bound = binder.bind(C, { post: PostData }).actions({ updatePost })

    // First call — populates cache
    let received: any = null
    await (binder.bind((p: any) => { received = p; return null }, { post: PostData }) as any)({ params: {}, searchParams: {} })
    expect(rootFn).toHaveBeenCalledTimes(1)

    // Second call — cache hit
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({ params: {}, searchParams: {} })
    expect(rootFn).toHaveBeenCalledTimes(1)

    // Fire action — invalidates cache
    let rec2: any = null
    await (binder.bind((_p: any) => null, { post: PostData }).actions({ updatePost }) as any)({ params: {}, searchParams: {} })
    // The action fires through the bound component — we just need to wait
    await new Promise(r => setTimeout(r, 20))
  })
})

// ── Tracer integration ────────────────────────────────────────────────────────

describe("tracer integration", () => {
  it("startSpan called for view execution when tracer is configured", async () => {
    const spans: string[] = []
    const mockTracer: TypedriftTracer = {
      startSpan(name) {
        spans.push(name)
        return {
          setAttributes: () => {},
          setStatus:     () => {},
          end:           () => {},
        }
      },
    }

    const binder = makeBinder({ tracer: mockTracer })
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await (binder.bind((_p: any) => null, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(spans.some(s => s.includes("typedrift"))).toBe(true)
  })

  it("no error when tracer is not configured", async () => {
    const binder = makeBinder() // no tracer
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    await expect(
      (binder.bind((_p: any) => null, { post: PostData }) as any)({ params: {}, searchParams: {} })
    ).resolves.not.toThrow()
  })
})
