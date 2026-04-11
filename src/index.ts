// typedrift — public surface

export { field, ref } from "./field/index.js"
export type {
  ScalarDescriptor,
  RelationDescriptor,
  AnyFieldDescriptor,
  AnyModelDescriptor,
  ScalarKind,
  RelationCardinality,
} from "./field/index.js"

export { model } from "./model/index.js"
export type { ModelDescriptor, ModelFields, ViewSelection } from "./model/index.js"

export { createView } from "./view/index.js"
export type {
  ViewDescriptor,
  BoundViewDescriptor,
  InferViewShape,
  InferBoundViewShape,
} from "./view/index.js"

export { createRegistry } from "./registry/index.js"
export type {
  Registry,
  ModelRegistration,
  RootResolver,
  RelationResolver,
} from "./registry/index.js"

export { createBinder } from "./binder/index.js"
export type {
  Binder,
  CreateBinderOptions,
  RawSource,
  InferProps,
} from "./binder/index.js"

export type {
  SelectionTree,
  BindContext,
  ResolverContext,
  RawContext,
} from "./types/index.js"
