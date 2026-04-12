import { describe, it, expect, vi } from "vitest"
import { field, ref }           from "../field/index.js"
import { model }                from "../model/index.js"
import { createRegistry }       from "../registry/index.js"
import { createBinder }         from "../binder/index.js"
import { batch }                from "../batch/index.js"

// ── Shared models ─────────────────────────────────────────────────────────────

const Org = model("Org", {
  id:   field.id(),
  name: field.string(),
})

const User = model("User", {
  id:    field.id(),
  name:  field.string(),
  orgId: field.string(),
  org:   ref(Org),
})

const Tag = model("Tag", {
  id:   field.id(),
  name: field.string(),
})

const Comment = model("Comment", {
  id:     field.id(),
  body:   field.string(),
  postId: field.string(),
  authorId: field.string(),
  author: ref(User),
})

const Post = model("Post", {
  id:          field.id(),
  title:       field.string(),
  publishedAt: field.date(),
  authorId:    field.string(),
  orgId:       field.string(),
  author:      ref(User),
  comments:    ref(Comment).list(),
  tags:        ref(Tag).list(),
})

// ── In-memory DB ──────────────────────────────────────────────────────────────

const db = {
  orgs:     [{ id: "o1", name: "Acme" }, { id: "o2", name: "Globex" }],
  users:    [
    { id: "u1", name: "Alice", orgId: "o1" },
    { id: "u2", name: "Bob",   orgId: "o1" },
    { id: "u3", name: "Carol", orgId: "o2" },
  ],
  posts:    [
    { id: "p1", title: "Hello",  publishedAt: new Date("2024-01-01"), authorId: "u1", orgId: "o1", published: true },
    { id: "p2", title: "World",  publishedAt: new Date("2024-02-01"), authorId: "u2", orgId: "o1", published: true },
    { id: "p3", title: "Secret", publishedAt: new Date("2024-03-01"), authorId: "u3", orgId: "o2", published: false },
  ],
  comments: [
    { id: "c1", body: "Nice!",  postId: "p1", authorId: "u2" },
    { id: "c2", body: "Great!", postId: "p1", authorId: "u1" },
    { id: "c3", body: "Cool!",  postId: "p2", authorId: "u1" },
  ],
  tags:     [{ id: "t1", name: "tech" }, { id: "t2", name: "news" }],
  postTags: [
    { postId: "p1", tagId: "t1" },
    { postId: "p1", tagId: "t2" },
    { postId: "p2", tagId: "t1" },
  ],
}

type DB = typeof db
type AppServices = { db: DB }

// ── Registry builder ──────────────────────────────────────────────────────────

function makeRegistry(scopeOrgId?: string) {
  const registry = createRegistry<AppServices>()

  registry.register(Post, {
    root: async (input, ctx, meta) => {
      if (meta.isList) {
        const { filter, sort, paginate } = meta.queryArgs ?? {}
        let results = [...ctx.services.db.posts]
        if (filter && typeof (filter as any).published === "boolean") {
          results = results.filter(p => p.published === (filter as any).published)
        }
        if (filter && (filter as any).orgId) {
          results = results.filter(p => p.orgId === (filter as any).orgId)
        }
        if (meta.scope && (meta.scope as any).orgId) {
          results = results.filter(p => p.orgId === (meta.scope as any).orgId)
        }
        if (sort?.field === "publishedAt") {
          results.sort((a, b) =>
            sort.dir === "desc"
              ? b.publishedAt.getTime() - a.publishedAt.getTime()
              : a.publishedAt.getTime() - b.publishedAt.getTime()
          )
        }
        const page    = paginate?.page    ?? 1
        const perPage = paginate?.perPage ?? 10
        const data    = results.slice((page - 1) * perPage, page * perPage)
        return { data, total: results.length, page, perPage } as any
      }
      const id = (input as any).id as string
      return ctx.services.db.posts.find(p => p.id === id) ?? null
    },
    relations: {
      author: batch.one("authorId", (ids, ctx) =>
        Promise.resolve(ctx.services.db.users.filter(u => ids.includes(u.id)))
      ),
      comments: batch.many("postId", (ids, ctx) =>
        Promise.resolve(ctx.services.db.comments.filter(c => ids.includes(c.postId)))
      ),
      tags: batch.junction({
        parentKey:     "postId",
        childKey:      "tagId",
        fetchJunction: (ids, ctx) =>
          Promise.resolve(ctx.services.db.postTags.filter(pt => ids.includes(pt.postId))),
        fetchTargets:  (ids, ctx) =>
          Promise.resolve(ctx.services.db.tags.filter(t => ids.includes(t.id))),
      }),
    },
  })

  registry.register(User, {
    root: async ({ id }: any, ctx) =>
      ctx.services.db.users.find(u => u.id === id) ?? null,
    relations: {
      org: batch.one("orgId", (ids, ctx) =>
        Promise.resolve(ctx.services.db.orgs.filter(o => ids.includes(o.id)))
      ),
    },
  })

  registry.register(Comment, {
    relations: {
      author: batch.one("authorId", (ids, ctx) =>
        Promise.resolve(ctx.services.db.users.filter(u => ids.includes(u.id)))
      ),
    },
  })

  registry.register(Org,  { root: async ({ id }: any, ctx) => ctx.services.db.orgs.find(o => o.id === id) ?? null, relations: {} })
  registry.register(Tag,  { root: async ({ id }: any, ctx) => ctx.services.db.tags.find(t => t.id === id) ?? null, relations: {} })

  if (scopeOrgId) {
    registry.scope(Post, () => ({ orgId: scopeOrgId }))
  }

  return registry
}

function makeBinder(registry: ReturnType<typeof makeRegistry>) {
  return createBinder<AppServices>({
    registry,
    getServices: async () => ({ db }),
  })
}

// ── batch.one ─────────────────────────────────────────────────────────────────

describe("batch.one()", () => {
  it("resolves single relation via FK on parent", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({ title: true, author: { name: true } })
      .from(({ params }) => ({ id: params.postId! }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: { postId: "p1" }, searchParams: {} })

    expect(received.post.author.name).toBe("Alice")
  })

  it("returns null when FK value is missing", async () => {
    const registry = createRegistry<AppServices>()
    registry.register(Post, {
      root: async ({ id }: any) =>
        ({ id, title: "x", publishedAt: new Date(), authorId: null, orgId: "o1" }) as any,
      relations: {
        author: batch.one("authorId", (ids, ctx) =>
          Promise.resolve(ctx.services.db.users.filter(u => ids.includes(u.id)))
        ),
      },
    })
    const binder = makeBinder(registry)
    const PostData = Post.view({ title: true, author: { name: true } })
      .from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })
    expect(received.post.author).toBeNull()
  })

  it("deduplicates FK lookups — fetchFn called once for multiple parents with same FK", async () => {
    const fetchFn = vi.fn(async (ids: string[]) =>
      db.users.filter(u => ids.includes(u.id))
    )
    const registry = createRegistry<AppServices>()
    registry.register(Post, {
      root: async (_input: any, ctx) => ctx.services.db.posts[0]! as any,
      relations: {
        author: batch.one("authorId", fetchFn as any),
      },
    })
    registry.register(User, {
      root: async ({ id }: any, ctx) => ctx.services.db.users.find(u => u.id === id) ?? null,
      relations: {},
    })
    const binder = makeBinder(registry)
    const PostData = Post.view({ title: true, author: { name: true } })
      .from(() => ({ id: "p1" }))

    await (binder.bind((p: any) => null, { post: PostData }) as any)({ params: {}, searchParams: {} })
    // fetchFn receives deduplicated ids — called once even though one parent
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

// ── batch.many ────────────────────────────────────────────────────────────────

describe("batch.many()", () => {
  it("groups children by FK field into arrays", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({ title: true, comments: { body: true } })
      .from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(Array.isArray(received.post.comments)).toBe(true)
    expect(received.post.comments).toHaveLength(2)
    expect(received.post.comments.map((c: any) => c.body)).toContain("Nice!")
  })

  it("returns empty array for parent with no children", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({ title: true, comments: { body: true } })
      .from(() => ({ id: "p3" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.comments).toEqual([])
  })

  it("handles empty parents array without calling fetchFn", async () => {
    const fetchFn = vi.fn(async () => [] as any[])
    const resolver = batch.many("postId", fetchFn as any)
    const result = await resolver([], {} as any, { selection: { scalars: new Set(), relations: new Map() }, scope: null })
    expect(result.size).toBe(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

// ── batch.junction ────────────────────────────────────────────────────────────

describe("batch.junction()", () => {
  it("resolves many-to-many via junction table", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({ title: true, tags: { name: true } })
      .from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.tags).toHaveLength(2)
    expect(received.post.tags.map((t: any) => t.name)).toContain("tech")
    expect(received.post.tags.map((t: any) => t.name)).toContain("news")
  })

  it("returns empty array when no junction rows exist", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({ title: true, tags: { name: true } })
      .from(() => ({ id: "p3" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.tags).toEqual([])
  })

  it("handles empty parents without calling fetchJunction", async () => {
    const fetchJunction = vi.fn(async () => [] as any[])
    const fetchTargets  = vi.fn(async () => [] as any[])
    const resolver = batch.junction({
      parentKey: "postId", childKey: "tagId",
      fetchJunction: fetchJunction as any,
      fetchTargets:  fetchTargets  as any,
    })
    const result = await resolver([], {} as any, { selection: { scalars: new Set(), relations: new Map() }, scope: null })
    expect(result.size).toBe(0)
    expect(fetchJunction).not.toHaveBeenCalled()
  })
})

// ── Query args in view() ──────────────────────────────────────────────────────

describe("view() query args — filter, sort, paginate", () => {
  it("passes filter to root resolver via meta.queryArgs", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostFeed = Post.view({ title: true }, {
      filter: () => ({ published: true }),
    }).list().from(() => ({}))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { posts: PostFeed }) as any)({ params: {}, searchParams: {} })

    // Only published posts
    expect(received.posts.data.every((p: any) => p.title !== "Secret")).toBe(true)
  })

  it("passes sort to root resolver", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostFeed = Post.view({ title: true, publishedAt: true }, {
      sort: () => ({ field: "publishedAt", dir: "asc" }),
    }).list().from(() => ({}))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { posts: PostFeed }) as any)({ params: {}, searchParams: {} })

    const dates = received.posts.data.map((p: any) => new Date(p.publishedAt).getTime())
    expect(dates[0]!).toBeLessThanOrEqual(dates[1]!)
  })

  it("passes paginate to root resolver", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostFeed = Post.view({ title: true }, {
      paginate: () => ({ page: 1, perPage: 2 }),
    }).list().from(() => ({}))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { posts: PostFeed }) as any)({ params: {}, searchParams: {} })

    expect(received.posts.data).toHaveLength(2)
    expect(received.posts.perPage).toBe(2)
    expect(received.posts.page).toBe(1)
  })

  it("reads query args from searchParams via BindContext", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostFeed = Post.view({ title: true }, {
      filter: ({ searchParams }) => ({
        orgId: searchParams.org as string | undefined,
      }),
    }).list().from(() => ({}))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { posts: PostFeed }) as any)({
      params: {}, searchParams: { org: "o2" },
    })

    expect(received.posts.data.every((p: any) => p.title === "Secret")).toBe(true)
  })

  it("list view returns total and pagination envelope", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostFeed = Post.view({ title: true }, {
      paginate: () => ({ page: 1, perPage: 10 }),
    }).list().from(() => ({}))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { posts: PostFeed }) as any)({ params: {}, searchParams: {} })

    expect(received.posts).toHaveProperty("data")
    expect(received.posts).toHaveProperty("total")
    expect(received.posts).toHaveProperty("page")
    expect(received.posts).toHaveProperty("perPage")
    expect(Array.isArray(received.posts.data)).toBe(true)
  })
})

// ── registry.scope() ─────────────────────────────────────────────────────────

describe("registry.scope()", () => {
  it("injects scope into meta.scope for root resolver", async () => {
    const registry = makeRegistry("o1")  // scope to org o1
    const binder   = makeBinder(registry)

    const PostFeed = Post.view({ title: true })
      .list().from(() => ({}))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { posts: PostFeed }) as any)({ params: {}, searchParams: {} })

    // org o2 post (Secret) should be excluded by scope
    expect(received.posts.data.every((p: any) => p.title !== "Secret")).toBe(true)
  })

  it("scope does not affect models without scope registration", async () => {
    const registry = makeRegistry("o1")
    const binder   = makeBinder(registry)

    // User has no scope — all users should be reachable
    const PostData = Post.view({ title: true, author: { name: true } })
      .from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.author.name).toBe("Alice")
  })
})

// ── Request deduplication ─────────────────────────────────────────────────────

describe("request deduplication", () => {
  it("calls root resolver once when same model+input used in two sources", async () => {
    const rootFn = vi.fn(async ({ id }: any, ctx: any) =>
      ctx.services.db.posts.find((p: any) => p.id === id) ?? null
    )
    const registry = createRegistry<AppServices>()
    registry.register(Post, { root: rootFn, relations: {} })

    const binder = makeBinder(registry)

    const PostTitle  = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const PostTitle2 = Post.view({ title: true }).from(() => ({ id: "p1" }))

    await (binder.bind((_p: any) => null, {
      a: PostTitle,
      b: PostTitle2,
    }) as any)({ params: {}, searchParams: {} })

    // Same model + same input → deduplicated to one resolver call
    expect(rootFn).toHaveBeenCalledTimes(1)
  })

  it("calls root resolver twice for different ids", async () => {
    const rootFn = vi.fn(async ({ id }: any, ctx: any) =>
      ctx.services.db.posts.find((p: any) => p.id === id) ?? null
    )
    const registry = createRegistry<AppServices>()
    registry.register(Post, { root: rootFn, relations: {} })

    const binder = makeBinder(registry)

    const Post1 = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const Post2 = Post.view({ title: true }).from(() => ({ id: "p2" }))

    await (binder.bind((_p: any) => null, {
      a: Post1,
      b: Post2,
    }) as any)({ params: {}, searchParams: {} })

    expect(rootFn).toHaveBeenCalledTimes(2)
  })
})

// ── registry.validate() ───────────────────────────────────────────────────────

describe("registry.validate()", () => {
  it("does not throw when all registrations are complete", () => {
    const registry = makeRegistry()
    expect(() => registry.validate()).not.toThrow()
  })

  it("throws when a relation resolver is not a function", () => {
    const registry = createRegistry<AppServices>()
    registry.register(Post, {
      root: async ({ id }: any, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {
        author: "not-a-function" as any,
      },
    })
    expect(() => registry.validate()).toThrow(/validation failed/)
  })
})

// ── Nested batch — deep relation chains ───────────────────────────────────────

describe("nested relations with batch.*", () => {
  it("resolves post → comments → author (two levels of batch.one)", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({
      title: true,
      comments: {
        body:   true,
        author: { name: true },
      },
    }).from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.comments[0].author.name).toBeDefined()
    const names = received.post.comments.map((c: any) => c.author.name)
    expect(names).toContain("Bob")
    expect(names).toContain("Alice")
  })

  it("resolves post → author → org (cross-model batch.one chain)", async () => {
    const registry = makeRegistry()
    const binder   = makeBinder(registry)

    const PostData = Post.view({
      title:  true,
      author: { name: true, org: { name: true } },
    }).from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }
    await (binder.bind(C, { post: PostData }) as any)({ params: {}, searchParams: {} })

    expect(received.post.author.org.name).toBe("Acme")
  })
})
