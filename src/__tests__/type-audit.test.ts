// ── Type-level audit — InferProps edge cases ──────────────────────────────────
// These tests use assignability assertions to verify InferProps infers
// correctly for the three critical edge cases before API freeze.

import { describe, it, expect } from "vitest"
import {
  model, field, ref,
  createRegistry, createBinder,
  action, batch,
  type InferProps,
  type ActionCallable,
  type ListResult,
  type StructuredError,
} from "../index.js"
import { createNextBinder, createNextLiveRoute } from "../next/index.js"

// ── Fixtures ──────────────────────────────────────────────────────────────────

const User = model("User", { id: field.id(), name: field.string() })
const Post = model("Post", {
  id:       field.id(),
  title:    field.string(),
  authorId: field.string(),
  author:   ref(User),
})

type AppServices = { db: typeof db }
type AppSession  = { userId: string; role: "admin" | "member" }

const db = {
  users: [{ id: "u1", name: "Alice" }],
  posts: [{ id: "p1", title: "Hello", authorId: "u1" }],
}

function makeRegistry() {
  const registry = createRegistry<AppServices, AppSession>()
  registry.register(Post, {
    root: async ({ id }: { id: string }, ctx) =>
      ctx.services.db.posts.find(p => p.id === id) ?? null,
    relations: {
      author: batch.one("authorId", (ids, ctx) =>
        Promise.resolve(ctx.services.db.users.filter(u => ids.includes(u.id)))
      ),
    },
  })
  registry.register(User, {
    root: async ({ id }: { id: string }, ctx) =>
      ctx.services.db.users.find(u => u.id === id) ?? null,
    relations: {},
  })
  return registry
}

const binder = createBinder<AppServices, AppSession>({
  registry:    makeRegistry(),
  getServices: async () => ({ db }),
  getSession:  async () => ({ userId: "u1", role: "member" }),
})

const postSchema = { parse: (d: unknown) => d as { title: string } }

// ── Views and actions ─────────────────────────────────────────────────────────

const PostData = Post.view({ title: true })
  .from(({ params }) => ({ id: params["postId"]! }))
  .nullable()

const PostFeed = Post.view({ title: true }, {
  paginate: () => ({ page: 1, perPage: 10 }),
}).list().from(() => ({}))

const createPost = action<{ title: string }, { id: string }, AppServices, AppSession>({
  input:   postSchema,
  execute: async (input) => ({ id: "new", title: input.title }),
})

// ── Type assertions via assignability ─────────────────────────────────────────

describe("InferProps type audit — edge cases", () => {

  // ── Case 1: list view shape ─────────────────────────────────────────────────
  it("list view infers ListResult<T> not T[]", () => {
    type FeedProps = InferProps<{ feed: typeof PostFeed }>

    // This is a runtime proxy for the type assertion
    // If the type is wrong, the assignment below would be a TS error
    const assert = (_: FeedProps["feed"]) => {}

    // ListResult has .data, .total, .page, .perPage
    // If this compiles, the shape is correct
    type HasData    = FeedProps["feed"] extends { data: { title: string }[] } ? true : false
    type HasTotal   = FeedProps["feed"] extends { total: number | null }      ? true : false
    type HasPage    = FeedProps["feed"] extends { page: number }              ? true : false
    type HasPerPage = FeedProps["feed"] extends { perPage: number }           ? true : false

    const isListResult: HasData & HasTotal & HasPage & HasPerPage = true
    expect(isListResult).toBe(true)
  })

  // ── Case 2: structured error wraps data sources but NOT actions ────────────
  it("structured errorBoundary wraps data sources but not actions", () => {
    type MixedProps = InferProps<{
      post:   typeof PostData
      create: typeof createPost
    }, "structured">

    // post should have { data, error } envelope
    type PostIsWrapped =
      MixedProps["post"] extends { data: unknown; error: StructuredError | null }
        ? true : false

    // create should be ActionCallable — NOT wrapped
    type CreateIsCallable =
      MixedProps["create"] extends ActionCallable<{ title: string }, { id: string }>
        ? true : false

    // create should NOT be wrapped in { data, error }
    type CreateIsNotWrapped =
      MixedProps["create"] extends { data: unknown; error: unknown }
        ? false : true

    const postWrapped:      PostIsWrapped      = true
    const createCallable:   CreateIsCallable   = true
    const createNotWrapped: CreateIsNotWrapped = true

    expect(postWrapped).toBe(true)
    expect(createCallable).toBe(true)
    expect(createNotWrapped).toBe(true)
  })

  // ── Case 3: action callable has state properties ───────────────────────────
  it("action callable carries pending, error, fieldErrors, lastResult", () => {
    type ActionProps = InferProps<{ create: typeof createPost }>

    type HasPending    = ActionProps["create"] extends { pending: boolean }                    ? true : false
    type HasError      = ActionProps["create"] extends { error: string | null }                ? true : false
    type HasFieldErr   = ActionProps["create"] extends { fieldErrors: Record<string, string> | null } ? true : false
    type HasLastResult = ActionProps["create"] extends { lastResult: { id: string } | null }  ? true : false

    const hasPending:    HasPending    = true
    const hasError:      HasError      = true
    const hasFieldErr:   HasFieldErr   = true
    const hasLastResult: HasLastResult = true

    expect(hasPending).toBe(true)
    expect(hasError).toBe(true)
    expect(hasFieldErr).toBe(true)
    expect(hasLastResult).toBe(true)
  })

  // ── Case 4: nullable view is T | null, not T ──────────────────────────────
  it("nullable view produces T | null, not T", () => {
    type PostProps = InferProps<{ post: typeof PostData }>

    type IsNullable  = PostProps["post"] extends { title: string } | null ? true : false
    type IsNotDirect = PostProps["post"] extends { title: string }        ? false : true

    const isNullable:  IsNullable  = true
    const isNotDirect: IsNotDirect = true

    expect(isNullable).toBe(true)
    expect(isNotDirect).toBe(true)
  })

  // ── Case 5: raw() source infers return type correctly ─────────────────────
  it("raw() source infers exact return type", () => {
    const rawSource = binder.raw(async () => [{ id: "1", title: "t" }])

    type RawProps = InferProps<{ results: typeof rawSource }>
    type IsArray  = RawProps["results"] extends { id: string; title: string }[] ? true : false

    const isArray: IsArray = true
    expect(isArray).toBe(true)
  })

  it("live descriptors are accepted by bind() and preserve prop shape", () => {
    const LivePost = Post.view({ title: true })
      .from(() => ({ id: "p1" }))
      .live()

    type LiveProps = InferProps<{ post: typeof LivePost }>
    type IsPlainShape = LiveProps["post"] extends { title: string } ? true : false

    const isPlainShape: IsPlainShape = true
    expect(isPlainShape).toBe(true)
  })

  it("createNextLiveRoute accepts typed next binders without casts", () => {
    const nextBinder = createNextBinder<AppServices, AppSession>({
      registry:    makeRegistry(),
      getServices: async () => ({ db }),
      getSession:  async () => ({ userId: "u1", role: "member" }),
    })

    const route = createNextLiveRoute(nextBinder)
    expect(typeof route).toBe("function")
  })

  it("batch helpers compose with registry service and session generics", () => {
    const Tag = model("Tag", { id: field.id(), label: field.string() })
    const TaggedPost = model("TaggedPost", {
      id: field.id(),
      authorId: field.string(),
      tagId: field.string(),
    })
    const Project = model("Project", {
      id: field.id(),
      ownerId: field.string(),
      owner: ref(User),
      tags: ref(Tag).list(),
    })

    type ExtendedServices = AppServices & {
      db: AppServices["db"] & {
        postTags: Array<{ id: string; projectId: string; tagId: string }>
        tags: Array<{ id: string; label: string }>
      }
    }

    const registry = createRegistry<ExtendedServices, AppSession>()
    registry.register(Project, {
      relations: {
        owner: batch.one("ownerId", async (ids, ctx) => {
          const role: AppSession["role"] | undefined = ctx.session?.role
          expect(role).toBeTypeOf("string")
          return ctx.services.db.users.filter((user) => ids.includes(user.id))
        }),
        tags: batch.junction({
          parentKey: "projectId",
          childKey: "tagId",
          fetchJunction: async (projectIds, ctx) => {
            const userId: string | undefined = ctx.session?.userId
            expect(userId).toBeTypeOf("string")
            return ctx.services.db.postTags.filter((row) => projectIds.includes(row.projectId))
          },
          fetchTargets: async (tagIds, ctx) => {
            const role: AppSession["role"] | undefined = ctx.session?.role
            expect(role).toBeTypeOf("string")
            return ctx.services.db.tags.filter((tag) => tagIds.includes(tag.id))
          },
        }),
      },
    })

    expect(registry).toBeDefined()
    void TaggedPost
  })

  // ── Runtime check: types produce correct runtime values ───────────────────
  it("runtime — bind() with action produces correct callable shape", async () => {
    const PostView = Post.view({ title: true })
      .from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder.bind(C, { post: PostView }).actions({ create: createPost })
    await (Bound as any)({ params: {}, searchParams: {} })

    // post is a plain value
    expect(received.post).toHaveProperty("title", "Hello")
    expect(received.post).not.toHaveProperty("data")
    expect(received.post).not.toHaveProperty("error")

    // create is a callable with state
    expect(typeof received.create).toBe("function")
    expect(received.create.pending).toBe(false)
    expect(received.create.error).toBeNull()
    expect(received.create.lastResult).toBeNull()
  })

  // ── Runtime check: structured mode wraps data, not actions ────────────────
  it("runtime — structured errorBoundary wraps post but not create", async () => {
    const PostView = Post.view({ title: true })
      .from(() => ({ id: "p1" }))

    let received: any = null
    const C = (p: any) => { received = p; return null }

    const Bound = binder
      .bind(C, { post: PostView }, { errorBoundary: "structured" })
      .actions({ create: createPost })

    await (Bound as any)({ params: {}, searchParams: {} })

    // post IS wrapped
    expect(received.post).toHaveProperty("data")
    expect(received.post).toHaveProperty("error")
    expect(received.post.data.title).toBe("Hello")
    expect(received.post.error).toBeNull()

    // create is NOT wrapped in { data, error } envelope
    // It IS an ActionCallable which has .error as action state (not envelope)
    expect(typeof received.create).toBe("function")
    // Envelope check: if wrapped, data would be null or an object — not a function
    expect(typeof received.create.data).toBe("undefined")   // no .data property = not wrapped
    expect(received.create.pending).toBe(false)             // has action state
    expect(received.create.error).toBeNull()                // .error is action state, starts null
    expect(received.create.lastResult).toBeNull()           // action state
  })
})
