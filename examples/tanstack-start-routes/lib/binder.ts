import { createBinder } from "typedrift"
import { registry, type AppServices } from "./registry"
// import { db } from "./db" // your actual db client

const db = {} as any // replace with real db

export const binder = createBinder<AppServices>({
  registry,
  getServices: async () => ({ db }),
})
