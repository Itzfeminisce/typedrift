import { createRegistry, batch } from "typedrift"
import { Post, User, Tag } from "./models"

const registry = createRegistry()

registry.register(Post, {
  root: async ({ id }, ctx) => null,
  relations: {
    // author resolver is missing
    // tags resolver is missing
  },
})

registry.register(User, {
  root: async ({ id }, ctx) => null,
  relations: {},
})

registry.register(Tag, {
  root: async ({ id }, ctx) => null,
  relations: {},
})
