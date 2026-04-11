import { describe, it, expect } from "vitest"
import { field, ref } from "../field/index.js"
import { model } from "../model/index.js"
import { createView } from "../view/index.js"

// ── Shared fixtures ───────────────────────────────────────────────────────────

const User = model("User", {
  id:        field.id(),
  name:      field.string(),
  avatarUrl: field.string().nullable(),
})

const Comment = model("Comment", {
  id:        field.id(),
  body:      field.string(),
  createdAt: field.date(),
  author:    ref(User),
})

const Post = model("Post", {
  id:          field.id(),
  title:       field.string(),
  publishedAt: field.date(),
  author:      ref(User),
  comments:    ref(Comment).list(),
})

// ── model() ───────────────────────────────────────────────────────────────────

describe("model()", () => {
  it("creates a model descriptor", () => {
    expect(User.__type).toBe("model")
    expect(User.name).toBe("User")
  })

  it("stores fields correctly", () => {
    expect(User.fields.id.__type).toBe("scalar")
    expect(User.fields.name.__type).toBe("scalar")
  })

  it("throws if id field is missing", () => {
    expect(() =>
      model("Bad", { name: field.string() } as any)
    ).toThrow(/missing a required "id" field/)
  })
})

// ── view() / createView() ─────────────────────────────────────────────────────

describe("view()", () => {
  it("creates a view descriptor", () => {
    const v = Post.view({ title: true })
    expect(v.__type).toBe("view")
    expect(v.model.name).toBe("Post")
  })

  it("throws on empty selection", () => {
    expect(() => Post.view({} as any)).toThrow(/empty views are not allowed/)
  })

  it("throws on unknown field", () => {
    expect(() =>
      createView(Post, { nope: true } as any)
    ).toThrow(/unknown field/)
  })

  it("throws when scalar selected with object instead of true", () => {
    expect(() =>
      createView(Post, { title: {} } as any)
    ).toThrow(/must be selected with `true`/)
  })

  it("throws when relation selected with true instead of object", () => {
    expect(() =>
      createView(Post, { author: true } as any)
    ).toThrow(/must be selected with a nested object/)
  })

  it("builds selectionTree with scalars", () => {
    const v = Post.view({ title: true, publishedAt: true })
    expect(v.selectionTree.scalars.has("title")).toBe(true)
    expect(v.selectionTree.scalars.has("publishedAt")).toBe(true)
    // id is always included automatically
    expect(v.selectionTree.scalars.has("id")).toBe(true)
  })

  it("builds selectionTree with nested relations", () => {
    const v = Post.view({
      title: true,
      author: { name: true },
    })
    expect(v.selectionTree.relations.has("author")).toBe(true)
    const authorTree = v.selectionTree.relations.get("author")!
    expect(authorTree.scalars.has("name")).toBe(true)
    expect(authorTree.scalars.has("id")).toBe(true)
  })

  it("builds selectionTree with list relations", () => {
    const v = Post.view({
      title: true,
      comments: { body: true },
    })
    expect(v.selectionTree.relations.has("comments")).toBe(true)
  })

  it("builds deeply nested selectionTree", () => {
    const v = Post.view({
      title: true,
      comments: {
        body: true,
        author: { name: true },
      },
    })
    const commentsTree = v.selectionTree.relations.get("comments")!
    expect(commentsTree.scalars.has("body")).toBe(true)
    expect(commentsTree.relations.has("author")).toBe(true)
    const authorTree = commentsTree.relations.get("author")!
    expect(authorTree.scalars.has("name")).toBe(true)
  })
})

// ── .from() ───────────────────────────────────────────────────────────────────

describe(".from()", () => {
  it("creates a bound view descriptor", () => {
    const bound = Post.view({ title: true }).from(({ params }) => ({
      id: params["postId"]!,
    }))
    expect(bound.__type).toBe("bound-view")
    expect(bound._nullable).toBe(false)
  })

  it(".nullable() on bound view flips _nullable", () => {
    const bound = Post.view({ title: true })
      .from(({ params }) => ({ id: params["postId"]! }))
      .nullable()
    expect(bound._nullable).toBe(true)
  })

  it("from resolver is callable with BindContext", () => {
    const bound = Post.view({ title: true }).from(({ params }) => ({
      id: params["postId"] ?? "fallback",
    }))
    const result = bound.from({
      params: { postId: "abc123" },
      searchParams: {},
    })
    expect(result).toEqual({ id: "abc123" })
  })
})
