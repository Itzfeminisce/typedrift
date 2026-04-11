import { describe, it, expect } from "vitest"
import { field, ref } from "../field/index.js"
import { model } from "../model/index.js"
import { createRegistry } from "../registry/index.js"

const User = model("User", {
  id:   field.id(),
  name: field.string(),
})

const Post = model("Post", {
  id:     field.id(),
  title:  field.string(),
  author: ref(User),
})

describe("createRegistry()", () => {
  it("registers a model without throwing", () => {
    const registry = createRegistry()
    expect(() =>
      registry.register(Post, {
        root: async ({ id }) => ({ id, title: "Hello", authorId: "u1" }),
        relations: {},
      })
    ).not.toThrow()
  })

  it("throws on double registration", () => {
    const registry = createRegistry()
    registry.register(Post, {
      root: async ({ id }) => ({ id, title: "t", authorId: "u1" }),
      relations: {},
    })
    expect(() =>
      registry.register(Post, {
        root: async ({ id }) => ({ id, title: "t2", authorId: "u2" }),
        relations: {},
      })
    ).toThrow(/already registered/)
  })

  it("_get returns undefined for unregistered model", () => {
    const registry = createRegistry()
    expect(registry._get("Nope")).toBeUndefined()
  })

  it("_get returns registration for registered model", () => {
    const registry = createRegistry()
    const reg = {
      root: async ({ id }: { id: string }) => ({ id, title: "t", authorId: "u1" }),
      relations: {},
    }
    registry.register(Post, reg)
    expect(registry._get("Post")).toBe(reg)
  })

  it("_hasRoot returns true when root resolver is present", () => {
    const registry = createRegistry()
    registry.register(Post, {
      root: async ({ id }) => ({ id, title: "t", authorId: "u1" }),
      relations: {},
    })
    expect(registry._hasRoot("Post")).toBe(true)
  })

  it("_hasRoot returns false when root resolver is absent", () => {
    const registry = createRegistry()
    registry.register(Post, { relations: {} })
    expect(registry._hasRoot("Post")).toBe(false)
  })
})
