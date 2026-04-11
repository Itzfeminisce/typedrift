import { describe, it, expect, vi } from "vitest"
import { field, ref } from "../field/index.js"
import { model } from "../model/index.js"
import { createRegistry } from "../registry/index.js"
import { createBinder } from "../binder/index.js"
import { relationModelRegistry } from "../binder/executor.js"

// ── Fixtures ──────────────────────────────────────────────────────────────────

const User = model("User", {
  id:        field.id(),
  name:      field.string(),
  avatarUrl: field.string().nullable(),
})

const Comment = model("Comment", {
  id:        field.id(),
  body:      field.string(),
  author:    ref(User),
})

const Post = model("Post", {
  id:          field.id(),
  title:       field.string(),
  publishedAt: field.date(),
  author:      ref(User),
  comments:    ref(Comment).list(),
})

// ── In-memory DB ──────────────────────────────────────────────────────────────

const db = {
  users: [
    { id: "u1", name: "Alice", avatarUrl: null },
    { id: "u2", name: "Bob",   avatarUrl: "https://example.com/bob.png" },
  ],
  posts: [
    { id: "p1", title: "Hello World", publishedAt: new Date("2024-01-01"), authorId: "u1" },
    { id: "p2", title: "Second Post", publishedAt: new Date("2024-02-01"), authorId: "u2" },
  ],
  comments: [
    { id: "c1", body: "Great post!", postId: "p1", authorId: "u2" },
    { id: "c2", body: "Thanks!",     postId: "p1", authorId: "u1" },
  ],
}

type DB = typeof db
type AppServices = { db: DB }

// ── Registry setup ─────────────────────────────────────────────────────────────

function makeRegistry() {
  const registry = createRegistry<AppServices>()

  registry.register(Post, {
    root: async ({ id }, ctx) => {
      return ctx.services.db.posts.find(p => p.id === id) ?? null
    },
    relations: {
      author: async (posts, ctx) => {
        const ids = new Set(posts.map(p => (p as any).authorId as string))
        const users = ctx.services.db.users.filter(u => ids.has(u.id))
        const byId = new Map(users.map(u => [u.id, u]))
        return new Map(posts.map(p => [(p as any).id as string, byId.get((p as any).authorId as string) ?? null]))
      },
      comments: async (posts, ctx) => {
        const postIds = new Set(posts.map(p => (p as any).id as string))
        const comments = ctx.services.db.comments.filter(c => postIds.has((c as any).postId as string))
        const byPost = new Map<string, typeof comments>()
        for (const c of comments) {
          const pid = (c as any).postId as string
          if (!byPost.has(pid)) byPost.set(pid, [])
          byPost.get(pid)!.push(c)
        }
        return new Map(posts.map(p => [(p as any).id as string, byPost.get((p as any).id as string) ?? []]))
      },
    },
  })

  registry.register(User, {
    root: async ({ id }, ctx) => {
      return ctx.services.db.users.find(u => u.id === id) ?? null
    },
    relations: {},
  })

  registry.register(Comment, {
    relations: {
      author: async (comments, ctx) => {
        const ids = new Set(comments.map(c => (c as any).authorId as string))
        const users = ctx.services.db.users.filter(u => ids.has(u.id))
        const byId = new Map(users.map(u => [u.id, u]))
        return new Map(comments.map(c => [(c as any).id as string, byId.get((c as any).authorId as string) ?? null]))
      },
    },
  })

  return registry
}

function makeBinder(registry: ReturnType<typeof makeRegistry>) {
  return createBinder<AppServices>({
    registry,
    getServices: async () => ({ db }),
  })
}

// ── Example 1: single record ──────────────────────────────────────────────────

describe("executor: single record", () => {
  it("resolves a simple view with scalars only", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const PostTitleData = Post.view({ title: true }).from(({ params }) => ({
      id: params["postId"]!,
    }))

    let received: any = null
    const Component = (props: any) => { received = props; return null }

    const Bound = binder.bind(Component, { post: PostTitleData })
    await (Bound as any)({ params: { postId: "p1" }, searchParams: {} })

    expect(received.post.title).toBe("Hello World")
    expect(received.post.id).toBe("p1")
  })

  it("resolves a view with a nested single relation", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const PostWithAuthor = Post.view({
      title: true,
      author: { name: true },
    }).from(({ params }) => ({ id: params["postId"]! }))

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { post: PostWithAuthor })
    await (Bound as any)({ params: { postId: "p1" }, searchParams: {} })

    expect(received.post.title).toBe("Hello World")
    expect(received.post.author.name).toBe("Alice")
  })

  it("resolves nullable relation correctly when null", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const PostWithNullableAuthor = Post.view({
      title: true,
      author: { name: true, avatarUrl: true },
    }).from(({ params }) => ({ id: params["postId"]! }))

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { post: PostWithNullableAuthor })
    await (Bound as any)({ params: { postId: "p1" }, searchParams: {} })

    // Alice has null avatarUrl
    expect(received.post.author.avatarUrl).toBeNull()
  })
})

// ── Example 2: nullable root ───────────────────────────────────────────────────

describe("executor: nullable root", () => {
  it("returns null when root resolver returns null and view is nullable", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const MissingPost = Post.view({ title: true })
      .from(({ params }) => ({ id: params["postId"]! }))
      .nullable()

    let received: any = undefined
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { post: MissingPost })
    await (Bound as any)({ params: { postId: "does-not-exist" }, searchParams: {} })

    expect(received.post).toBeNull()
  })

  it("throws when root returns null and view is not nullable", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const StrictPost = Post.view({ title: true })
      .from(({ params }) => ({ id: params["postId"]! }))

    const Component = (_props: any) => null
    const Bound = binder.bind(Component, { post: StrictPost })

    await expect(
      (Bound as any)({ params: { postId: "does-not-exist" }, searchParams: {} })
    ).rejects.toThrow(/returned null/)
  })
})

// ── Example 3: nested list relations ─────────────────────────────────────────

describe("executor: nested list relations", () => {
  it("resolves list relations correctly", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const DiscussionData = Post.view({
      title: true,
      comments: {
        body: true,
      },
    }).from(({ params }) => ({ id: params["postId"]! }))

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { post: DiscussionData })
    await (Bound as any)({ params: { postId: "p1" }, searchParams: {} })

    expect(Array.isArray(received.post.comments)).toBe(true)
    expect(received.post.comments).toHaveLength(2)
    expect(received.post.comments[0].body).toBe("Great post!")
  })

  it("resolves deeply nested list + single relation", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const FullDiscussion = Post.view({
      title: true,
      comments: {
        body: true,
        author: { name: true },
      },
    }).from(({ params }) => ({ id: params["postId"]! }))

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { post: FullDiscussion })
    await (Bound as any)({ params: { postId: "p1" }, searchParams: {} })

    expect(received.post.comments[0].author.name).toBe("Bob")
    expect(received.post.comments[1].author.name).toBe("Alice")
  })
})

// ── Example 4: raw() escape hatch ────────────────────────────────────────────

describe("binder.raw()", () => {
  it("executes raw source and injects result", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const SearchResults = binder.raw(async ({ bind, services }) => {
      const q = typeof bind.searchParams["q"] === "string"
        ? bind.searchParams["q"]
        : ""
      return services.db.posts.filter(p =>
        p.title.toLowerCase().includes(q.toLowerCase())
      )
    })

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { results: SearchResults })
    await (Bound as any)({ params: {}, searchParams: { q: "hello" } })

    expect(received.results).toHaveLength(1)
    expect(received.results[0].title).toBe("Hello World")
  })

  it("returns empty array when no results match", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const SearchResults = binder.raw(async ({ bind, services }) => {
      const q = typeof bind.searchParams["q"] === "string" ? bind.searchParams["q"] : ""
      return services.db.posts.filter(p => p.title.includes(q))
    })

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, { results: SearchResults })
    await (Bound as any)({ params: {}, searchParams: { q: "zzznomatch" } })

    expect(received.results).toHaveLength(0)
  })
})

// ── Example 5: mixed bound view + raw in same bind() ─────────────────────────

describe("binder.bind(): mixed sources", () => {
  it("resolves both bound view and raw source in parallel", async () => {
    const registry = makeRegistry()
    const binder = makeBinder(registry)

    const PostData = Post.view({ title: true })
      .from(({ params }) => ({ id: params["postId"]! }))
      .nullable()

    const RelatedPosts = binder.raw(async ({ services }) =>
      services.db.posts.slice(0, 2)
    )

    let received: any = null
    const Component = (props: any) => { received = props; return null }
    const Bound = binder.bind(Component, {
      post: PostData,
      related: RelatedPosts,
    })
    await (Bound as any)({ params: { postId: "p1" }, searchParams: {} })

    expect(received.post.title).toBe("Hello World")
    expect(received.related).toHaveLength(2)
  })
})

// ── Error cases ────────────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws when model is not registered", async () => {
    const registry = createRegistry<AppServices>()
    // Intentionally register nothing
    const binder = createBinder<AppServices>({
      registry,
      getServices: async () => ({ db }),
    })

    const PostData = Post.view({ title: true })
      .from(() => ({ id: "p1" }))

    const Component = (_props: any) => null
    const Bound = binder.bind(Component, { post: PostData })

    await expect(
      (Bound as any)({ params: {}, searchParams: {} })
    ).rejects.toThrow(/No registration for model "Post"/)
  })

  it("throws when relation resolver is missing", async () => {
    const registry = createRegistry<AppServices>()
    registry.register(Post, {
      root: async ({ id }, ctx) =>
        ctx.services.db.posts.find(p => p.id === id) ?? null,
      relations: {
        // author resolver deliberately omitted
      },
    })

    const binder = createBinder<AppServices>({
      registry,
      getServices: async () => ({ db }),
    })

    const PostWithAuthor = Post.view({
      title: true,
      author: { name: true },
    }).from(() => ({ id: "p1" }))

    const Component = (_props: any) => null
    const Bound = binder.bind(Component, { post: PostWithAuthor })

    await expect(
      (Bound as any)({ params: {}, searchParams: {} })
    ).rejects.toThrow(/No relation resolver for "Post.author"/)
  })
})
