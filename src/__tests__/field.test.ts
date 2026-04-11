import { describe, it, expect } from "vitest"
import { field, ref, isScalarDescriptor, isRelationDescriptor } from "../field/index.js"
import { model } from "../model/index.js"

describe("field", () => {
  it("creates scalar descriptors with correct kind", () => {
    expect(field.id().__type).toBe("scalar")
    expect(field.id().kind).toBe("id")
    expect(field.string().kind).toBe("string")
    expect(field.number().kind).toBe("number")
    expect(field.boolean().kind).toBe("boolean")
    expect(field.date().kind).toBe("date")
  })

  it("scalars default to non-nullable", () => {
    expect(field.string()._nullable).toBe(false)
  })

  it(".nullable() returns a new descriptor with _nullable true", () => {
    const f = field.string().nullable()
    expect(f._nullable).toBe(true)
    expect(f.kind).toBe("string")
  })

  it("isScalarDescriptor correctly identifies scalars", () => {
    expect(isScalarDescriptor(field.string())).toBe(true)
    expect(isScalarDescriptor(field.date().nullable())).toBe(true)
  })
})

describe("ref", () => {
  const User = model("User", { id: field.id(), name: field.string() })

  it("creates a relation descriptor", () => {
    const r = ref(User)
    expect(r.__type).toBe("relation")
    expect(r.cardinality).toBe("one")
    expect(r._nullable).toBe(false)
    expect(r.model.name).toBe("User")
  })

  it(".nullable() flips _nullable", () => {
    const r = ref(User).nullable()
    expect(r._nullable).toBe(true)
    expect(r.cardinality).toBe("one")
  })

  it(".list() sets cardinality to many and resets nullable", () => {
    const r = ref(User).list()
    expect(r.cardinality).toBe("many")
    expect(r._nullable).toBe(false)
  })

  it("isRelationDescriptor correctly identifies relations", () => {
    expect(isRelationDescriptor(ref(User))).toBe(true)
    expect(isRelationDescriptor(field.string())).toBe(false)
  })
})
