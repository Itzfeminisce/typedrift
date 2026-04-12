// typedrift v0.4.0 — public surface

export { field, ref }            from "./field/index.js"
export type {
  ScalarDescriptor, RelationDescriptor,
  AnyFieldDescriptor, AnyModelDescriptor,
  ScalarKind, RelationCardinality,
}                                from "./field/index.js"

export { model }                 from "./model/index.js"
export type { ModelDescriptor, ModelFields, ViewSelection } from "./model/index.js"

export { createView }            from "./view/index.js"
export type {
  ViewDescriptor, BoundViewDescriptor,
  ListViewDescriptor, InferViewShape, InferBoundViewShape,
}                                from "./view/index.js"

export { createRegistry }        from "./registry/index.js"
export type {
  Registry, ModelRegistration,
  RootResolver, RelationResolver, ScopeFn,
}                                from "./registry/index.js"

export { batch }                 from "./batch/index.js"
export type {
  BatchFetchFn, JunctionFetchFn, TargetFetchFn,
  JunctionConfig, BatchResolver,
}                                from "./batch/index.js"

export { createBinder }          from "./binder/index.js"
export type {
  Binder, CreateBinderOptions,
  RawSource, InferProps, InferActionProps,
  BindOptions, ErrorBoundaryMode,
  BoundComponent,
}                                from "./binder/index.js"

// v0.4.0 — action()
export { action }                from "./action/index.js"
export type {
  ActionDefinition, ActionCallable,
  ActionOptions, ActionState,
  ParseSchema, OnSuccessFn, OnSuccessResult,
  InferActionInput, InferActionResult,
}                                from "./action/index.js"

export { middleware, runMiddleware } from "./middleware/index.js"
export type {
  Middleware, MiddlewareContext,
  OperationDescriptor, Next,
}                                from "./middleware/index.js"

export {
  TypedriftError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  RateLimitError,
  InternalError,
  isTypedriftError,
}                                from "./errors/index.js"
export type {
  TypedriftErrorCode, StructuredError,
}                                from "./errors/index.js"

export type {
  SelectionTree, BindContext,
  ResolverContext, RawContext,
  ResolvedQueryArgs, QueryArgDefs,
  ListResult, RootResolverMeta, RelationResolverMeta,
}                                from "./types/index.js"
