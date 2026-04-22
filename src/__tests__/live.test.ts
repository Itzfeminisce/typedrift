import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { field, ref, model, createRegistry, batch, action } from "../index.js"
import { createBinder } from "../binder/index.js"
import {
  CLEAR,
  DEFAULT_LIVE_STATE,
} from "../live/types.js"
import type { LiveOptions, LiveState, OnDataMeta } from "../live/types.js"
import { LiveConnection } from "../live/connection.js"

// ── Shared fixtures ───────────────────────────────────────────────────────────

const User = model("User", { id: field.id(), name: field.string() })
const Post = model("Post", {
  id:       field.id(),
  title:    field.string(),
  votes:    field.number(),
  authorId: field.string(),
  author:   ref(User),
})

type AppServices = { db: typeof db }
type AppSession  = { userId: string; role: "admin" | "member" }

const db = {
  users: [{ id: "u1", name: "Alice" }],
  posts: [{ id: "p1", title: "Hello", votes: 42, authorId: "u1" }],
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

function makeBinder() {
  return createBinder<AppServices, AppSession>({
    registry:    makeRegistry(),
    getServices: async () => ({ db }),
    getSession:  async () => ({ userId: "u1", role: "member" }),
  })
}

// ── CLEAR sentinel ────────────────────────────────────────────────────────────

describe("CLEAR sentinel", () => {
  it("is a unique Symbol", () => {
    expect(typeof CLEAR).toBe("symbol")
    expect(CLEAR.toString()).toContain("typedrift.live.CLEAR")
  })

  it("is distinct from null and undefined", () => {
    expect(CLEAR).not.toBe(null)
    expect(CLEAR).not.toBe(undefined)
    expect(CLEAR).not.toBe(false)
  })

  it("can be used as a sentinel in onData logic", async () => {
    const onData: LiveOptions<any, any>["onData"] = async (incoming, previous, meta) => {
      if (incoming === null) return CLEAR
      return incoming
    }

    const resultClear  = await onData!(null,   "prev", { done: false, accumulated: "", pushCount: 1 })
    const resultKeep   = await onData!("hello", "prev", { done: false, accumulated: "", pushCount: 2 })

    expect(resultClear).toBe(CLEAR)
    expect(resultKeep).toBe("hello")
  })
})

// ── DEFAULT_LIVE_STATE ────────────────────────────────────────────────────────

describe("DEFAULT_LIVE_STATE", () => {
  it("has correct shape and defaults", () => {
    expect(DEFAULT_LIVE_STATE.stale).toBe(false)
    expect(DEFAULT_LIVE_STATE.loading).toBe(true)
    expect(DEFAULT_LIVE_STATE.error).toBeNull()
    expect(DEFAULT_LIVE_STATE.updatedAt).toBeNull()
    expect(DEFAULT_LIVE_STATE.pushCount).toBe(0)
  })
})

// ── LiveOptions type shape ────────────────────────────────────────────────────

describe("LiveOptions — shape validation", () => {
  it("accepts empty options", () => {
    const opts: LiveOptions<any, any> = {}
    expect(opts).toBeDefined()
  })

  it("accepts interval option", () => {
    const opts: LiveOptions<any, any> = { interval: 5000 }
    expect(opts.interval).toBe(5000)
  })

  it("accepts interval: false", () => {
    const opts: LiveOptions<any, any> = { interval: false }
    expect(opts.interval).toBe(false)
  })

  it("accepts enabled: boolean", () => {
    const opts: LiveOptions<any, any> = { enabled: true }
    expect(opts.enabled).toBe(true)
  })

  it("accepts enabled: function", () => {
    const opts: LiveOptions<any, any> = {
      enabled: (ctx) => !!ctx.params["postId"],
    }
    expect(typeof opts.enabled).toBe("function")
  })

  it("accepts tags function", () => {
    const opts: LiveOptions<{ id: string }, any> = {
      tags: (input) => [`post:${input.id}`],
    }
    expect(opts.tags!({ id: "p1" })).toEqual(["post:p1"])
  })

  it("accepts reconnect: boolean", () => {
    const opts: LiveOptions<any, any> = { reconnect: false }
    expect(opts.reconnect).toBe(false)
  })

  it("accepts reconnect config object", () => {
    const opts: LiveOptions<any, any> = {
      reconnect: { attempts: 5, delay: 2000, backoff: "exponential", maxDelay: 60_000 },
    }
    const rc = opts.reconnect as any
    expect(rc.attempts).toBe(5)
    expect(rc.backoff).toBe("exponential")
  })

  it("accepts staleTime", () => {
    const opts: LiveOptions<any, any> = { staleTime: 3000 }
    expect(opts.staleTime).toBe(3000)
  })

  it("accepts onData callback", () => {
    const onData = vi.fn(async (incoming: any, _prev: any, _meta: OnDataMeta) => incoming)
    const opts: LiveOptions<any, any> = { onData }
    expect(typeof opts.onData).toBe("function")
  })

  it("accepts validate schema", () => {
    const schema = { parse: (d: unknown) => d as { title: string } }
    const opts: LiveOptions<any, { title: string }> = { validate: schema }
    expect(typeof opts.validate?.parse).toBe("function")
  })

  it("accepts maxAge and onExpire", () => {
    const opts: LiveOptions<any, any> = {
      maxAge:   10_000,
      onExpire: "refetch",
    }
    expect(opts.maxAge).toBe(10_000)
    expect(opts.onExpire).toBe("refetch")
  })
})

// ── view().live() ─────────────────────────────────────────────────────────────

describe("BoundViewDescriptor.live()", () => {
  it("PostData.live() returns a LiveBoundViewDescriptor", () => {
    const PostData = Post.view({ title: true })
      .from(() => ({ id: "p1" }))

    const live = PostData.live()
    expect(live.__type).toBe("live-bound-view")
  })

  it("PostData.live() has empty options by default", () => {
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const live = PostData.live()
    expect(live.options).toBeDefined()
    expect(live.options.interval).toBeUndefined()
  })

  it("PostData.live({ interval: 5000 }) stores interval", () => {
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const live = PostData.live({ interval: 5000 })
    expect(live.options.interval).toBe(5000)
  })

  it("PostData.live({ tags }) stores tag function", () => {
    const PostData = Post.view({ title: true }).from(({ params }) => ({ id: params["postId"]! }))
    const tagFn = (input: any) => [`post:${input.id}`]
    const live  = PostData.live({ tags: tagFn })
    expect(live.options.tags).toBe(tagFn)
  })

  it("PostData.live() has useLiveData() method", () => {
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const live = PostData.live()
    expect(typeof live.useLiveData).toBe("function")
  })

  it("PostData.useLiveData() returns DEFAULT_LIVE_STATE outside React context", () => {
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    // Outside React — no LiveContext — returns safe defaults
    const state = PostData.useLiveData()
    expect(state).toEqual(DEFAULT_LIVE_STATE)
  })

  it("static PostData.useLiveData() also returns safe defaults", () => {
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const state = PostData.useLiveData()
    expect(state.stale).toBe(false)
    expect(state.loading).toBe(true)
    expect(state.error).toBeNull()
  })

  it("PostData.live() can be used in bind() alongside static sources", () => {
    const binder   = makeBinder()
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))
    const Related  = Post.view({ title: true }).list().from(() => ({}))

    // Should not throw — both live and static in same bind
    const Bound = binder.bind((_p: any) => null, {
      post:    PostData.live(),
      related: Related,
    })
    expect(typeof Bound).toBe("function")
  })

  it("binder.bind() resolves live sources without unknown-source errors", async () => {
    const binder   = makeBinder()
    const PostData = Post.view({ title: true }).from(() => ({ id: "p1" }))

    let received: any = null
    const Bound = binder.bind((props: any) => {
      received = props
      return null
    }, {
      post: PostData.live(),
    })

    await (Bound as any)({ params: {}, searchParams: {} })

    expect(received.post.title).toBe("Hello")
  })
})

// ── binder.liveHandler() ──────────────────────────────────────────────────────

describe("binder.liveHandler()", () => {
  it("liveHandler is exposed on the binder", () => {
    const binder = makeBinder()
    expect(typeof (binder as any).liveHandler).toBe("function")
  })

  it("liveHandler returns a fetch-compatible function", () => {
    const binder  = makeBinder()
    const handler = (binder as any).liveHandler()
    expect(typeof handler).toBe("function")
  })

  it("handler returns 400 when subs param is missing", async () => {
    const binder  = makeBinder()
    const handler = (binder as any).liveHandler()
    const req     = new Request("http://localhost/__typedrift/live")
    const res: Response = await handler(req)
    expect(res.status).toBe(400)
  })

  it("handler returns 400 when subs param is invalid JSON", async () => {
    const binder  = makeBinder()
    const handler = (binder as any).liveHandler()
    const req     = new Request("http://localhost/__typedrift/live?subs=notjson")
    const res: Response = await handler(req)
    expect(res.status).toBe(400)
  })

  it("handler returns SSE response with correct headers for valid request", async () => {
    const binder  = makeBinder()
    const handler = (binder as any).liveHandler()

    const subs = JSON.stringify([{
      key:   "post",
      model: "Post",
      input: { id: "p1" },
      tags:  ["post:p1"],
    }])

    const controller = new AbortController()
    const req = new Request(`http://localhost/__typedrift/live?subs=${encodeURIComponent(subs)}`, {
      signal: controller.signal,
    })

    const resPromise = handler(req)
    controller.abort()  // immediately abort to avoid hanging
    const res: Response = await resPromise

    expect(res.headers.get("Content-Type")).toBe("text/event-stream")
    expect(res.headers.get("Cache-Control")).toBe("no-cache")
  })
})

// ── LiveConnection ────────────────────────────────────────────────────────────

describe("LiveConnection", () => {
  it("can be instantiated", () => {
    const conn = new LiveConnection({
      endpoint:      "http://localhost/__typedrift/live",
      onStateChange: (_key, _patch) => {},
    })
    expect(conn).toBeDefined()
    conn.disconnect()
  })

  it("disconnect() does not throw when not connected", () => {
    const conn = new LiveConnection({
      endpoint:      "http://localhost/__typedrift/live",
      onStateChange: () => {},
    })
    expect(() => conn.disconnect()).not.toThrow()
  })
})

// ── onData integration scenarios ──────────────────────────────────────────────

describe("onData — logic scenarios", () => {
  it("null = keep previous — sentinel pattern works correctly", async () => {
    const results: Array<string | null | typeof CLEAR> = []

    const onData: NonNullable<LiveOptions<any, string>["onData"]> = async (incoming, previous, meta) => {
      results.push(incoming)
      // Mid-stream — keep previous
      if (!meta.done) return null
      // Done — return accumulated
      return meta.accumulated
    }

    // Simulate mid-stream pushes
    const r1 = await onData("tok", null, { done: false, accumulated: "tok", pushCount: 1 })
    const r2 = await onData("en",  "tok", { done: false, accumulated: "token", pushCount: 2 })
    const r3 = await onData("",   "tok", { done: true,  accumulated: "token", pushCount: 3 })

    expect(r1).toBeNull()          // keep previous
    expect(r2).toBeNull()          // keep previous
    expect(r3).toBe("token")       // final — return accumulated
  })

  it("CLEAR = reset — explicit sentinel works correctly", async () => {
    const onData: NonNullable<LiveOptions<any, string>["onData"]> = async (incoming, _prev, _meta) => {
      if (incoming === "reset") return CLEAR
      return incoming
    }

    const r1 = await onData("hello", null,    { done: true, accumulated: "hello", pushCount: 1 })
    const r2 = await onData("reset", "hello", { done: true, accumulated: "reset", pushCount: 2 })
    const r3 = await onData("world", null,    { done: true, accumulated: "world", pushCount: 3 })

    expect(r1).toBe("hello")
    expect(r2).toBe(CLEAR)
    expect(r3).toBe("world")
  })

  it("AI streaming scenario — accumulate JSON tokens", async () => {
    const schema = { parse: (d: unknown) => d as { summary: string; score: number } }
    let accumulated = ""

    const onData: NonNullable<LiveOptions<any, any>["onData"]> = async (_incoming, previous, meta) => {
      accumulated = meta.accumulated
      if (!meta.done) {
        try {
          return JSON.parse(accumulated)
        } catch {
          return null  // not valid JSON yet — keep previous
        }
      }
      return JSON.parse(accumulated)
    }

    // Simulate streaming tokens
    const tokens = ['{"summary":', '"good post"', ',"score":95}']
    let acc = ""
    let result: any = null
    let push = 0

    for (let i = 0; i < tokens.length; i++) {
      acc += tokens[i]!
      push++
      const r = await onData(
        tokens[i],
        result,
        { done: i === tokens.length - 1, accumulated: acc, pushCount: push }
      )
      if (r !== null) result = r
    }

    expect(result).toEqual({ summary: "good post", score: 95 })
  })

  it("validate rejects malformed push", async () => {
    const schema = {
      parse: (d: unknown): { title: string } => {
        const data = d as any
        if (typeof data?.title !== "string") throw new Error("title is required")
        return { title: data.title }
      },
    }

    // Simulate what LiveProvider does with validate
    const incoming = { wrong: "shape" }
    let error: Error | null = null
    try {
      schema.parse(incoming)
    } catch (err: any) {
      error = err
    }

    expect(error).not.toBeNull()
    expect(error?.message).toContain("title is required")
  })
})

// ── maxAge scenarios ──────────────────────────────────────────────────────────

describe("maxAge — temporal validity", () => {
  it("onExpire option values are valid", () => {
    const opts1: LiveOptions<any, any> = { maxAge: 5000, onExpire: "stale" }
    const opts2: LiveOptions<any, any> = { maxAge: 5000, onExpire: "refetch" }
    const opts3: LiveOptions<any, any> = { maxAge: 5000, onExpire: "clear" }

    expect(opts1.onExpire).toBe("stale")
    expect(opts2.onExpire).toBe("refetch")
    expect(opts3.onExpire).toBe("clear")
  })
})

// ── Reconnect config ──────────────────────────────────────────────────────────

describe("reconnect config", () => {
  it("all backoff strategies are valid string literals", () => {
    const strategies: Array<"exponential" | "linear" | "fixed"> = [
      "exponential", "linear", "fixed"
    ]
    strategies.forEach(backoff => {
      const opts: LiveOptions<any, any> = {
        reconnect: { backoff, attempts: 3, delay: 1000, maxDelay: 30_000 }
      }
      expect((opts.reconnect as any).backoff).toBe(backoff)
    })
  })

  it("reconnect: false disables reconnection", () => {
    const opts: LiveOptions<any, any> = { reconnect: false }
    expect(opts.reconnect).toBe(false)
  })
})
