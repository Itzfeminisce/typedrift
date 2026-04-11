// ─── View ─────────────────────────────────────────────────────────────────────
//
// A view is the single read contract that drives both:
//   1. the TypeScript prop type the component receives
//   2. the selection tree the registry uses to execute resolvers

import type { SelectionTree, BindContext } from "../types/index.js"
import type { ModelFields, ViewSelection } from "../model/index.js"
import type {
  AnyModelDescriptor,
  ScalarDescriptor,
  RelationDescriptor,
  ScalarKind,
  RelationCardinality,
  AnyFieldDescriptor,
} from "../field/index.js"
import { isScalarDescriptor, isRelationDescriptor } from "../field/index.js"

// ── Shape inference ───────────────────────────────────────────────────────────

type ScalarShape<TKind extends ScalarKind, TNullable extends boolean> =
  TNullable extends true
    ? (TKind extends "id"      ? string  :
       TKind extends "string"  ? string  :
       TKind extends "number"  ? number  :
       TKind extends "boolean" ? boolean :
       TKind extends "date"    ? Date    :
       never) | null
    : (TKind extends "id"      ? string  :
       TKind extends "string"  ? string  :
       TKind extends "number"  ? number  :
       TKind extends "boolean" ? boolean :
       TKind extends "date"    ? Date    :
       never)

export type InferSelectionShape<
  TFields extends ModelFields,
  TSelection extends ViewSelection<TFields>,
> = {
  [K in keyof TSelection & keyof TFields]:
    TFields[K] extends ScalarDescriptor<infer TKind, infer TNullable>
      ? TSelection[K] extends true
        ? ScalarShape<TKind, TNullable>
        : never
      : TFields[K] extends RelationDescriptor<
          infer TRelModel,
          infer TCardinality,
          infer TNullable
        >
        ? TSelection[K] extends ViewSelection<TRelModel["fields"]>
          ? TCardinality extends "many"
            ? Array<InferSelectionShape<TRelModel["fields"] & ModelFields, TSelection[K] & ViewSelection<TRelModel["fields"]>>>
            : TNullable extends true
              ? InferSelectionShape<TRelModel["fields"] & ModelFields, TSelection[K] & ViewSelection<TRelModel["fields"]>> | null
              : InferSelectionShape<TRelModel["fields"] & ModelFields, TSelection[K] & ViewSelection<TRelModel["fields"]>>
          : never
        : never
}

// ── FromResolver ──────────────────────────────────────────────────────────────

export type FromResolver<TInput> = (ctx: BindContext) => TInput

// ── BoundViewDescriptor ───────────────────────────────────────────────────────

export type BoundViewDescriptor<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
  TShape,
  TNullable extends boolean = false,
> = {
  readonly __type: "bound-view"
  readonly view: ViewDescriptor<TModel, TSelection>
  readonly from: FromResolver<Record<string, unknown>>
  readonly _nullable: TNullable
  nullable(): BoundViewDescriptor<TModel, TSelection, TShape, true>
  readonly shape: TNullable extends true ? TShape | null : TShape
}

// ── ViewDescriptor ────────────────────────────────────────────────────────────

export type ViewDescriptor<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
> = {
  readonly __type: "view"
  readonly model: TModel
  readonly selection: TSelection
  readonly shape: InferSelectionShape<TModel["fields"] & ModelFields, TSelection>
  readonly selectionTree: SelectionTree
  from<TInput extends Record<string, unknown>>(
    resolver: FromResolver<TInput>,
  ): BoundViewDescriptor<
    TModel,
    TSelection,
    InferSelectionShape<TModel["fields"] & ModelFields, TSelection>,
    false
  >
}

// ── SelectionTree builder ─────────────────────────────────────────────────────

function buildSelectionTree(
  fields: ModelFields,
  selection: Record<string, unknown>,
): SelectionTree {
  const scalars = new Set<string>()
  const relations = new Map<string, SelectionTree>()

  // Always include id for identity resolution
  scalars.add("id")

  for (const [key, value] of Object.entries(selection)) {
    if (!(key in fields)) {
      throw new Error(`[typedrift] view() selection contains unknown field: "${key}"`)
    }

    const fieldDef = fields[key] as AnyFieldDescriptor

    if (isScalarDescriptor(fieldDef)) {
      if (value !== true) {
        throw new Error(
          `[typedrift] Scalar field "${key}" must be selected with \`true\`. Got: ${JSON.stringify(value)}`
        )
      }
      scalars.add(key)
    } else if (isRelationDescriptor(fieldDef)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(
          `[typedrift] Relation field "${key}" must be selected with a nested object. Got: ${JSON.stringify(value)}`
        )
      }
      const subTree = buildSelectionTree(
        (fieldDef.model as AnyModelDescriptor).fields as ModelFields,
        value as Record<string, unknown>,
      )
      relations.set(key, subTree)
    }
  }

  return { scalars, relations }
}

// ── BoundView factory ─────────────────────────────────────────────────────────

function makeBoundView<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
  TShape,
>(
  view: ViewDescriptor<TModel, TSelection>,
  fromResolver: FromResolver<Record<string, unknown>>,
  _nullable: boolean,
): BoundViewDescriptor<TModel, TSelection, TShape, any> {
  const descriptor: BoundViewDescriptor<TModel, TSelection, TShape, any> = {
    __type: "bound-view",
    view,
    from: fromResolver,
    _nullable,
    nullable() {
      return makeBoundView(view, fromResolver, true)
    },
    get shape(): any {
      throw new Error("[typedrift] .shape is a compile-time type accessor only.")
    },
  }
  return descriptor
}

// ── createView ────────────────────────────────────────────────────────────────

export function createView<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
>(
  modelDef: TModel,
  selection: TSelection,
): ViewDescriptor<TModel, TSelection> {
  if (Object.keys(selection).length === 0) {
    throw new Error(
      `[typedrift] ${modelDef.name}.view({}) — empty views are not allowed. Select at least one field.`
    )
  }

  const selectionTree = buildSelectionTree(
    modelDef.fields as ModelFields,
    selection as Record<string, unknown>,
  )

  const descriptor: ViewDescriptor<TModel, TSelection> = {
    __type: "view",
    model: modelDef,
    selection,
    selectionTree,
    get shape(): any {
      throw new Error("[typedrift] .shape is a compile-time type accessor only.")
    },
    from(resolver) {
      return makeBoundView(descriptor, resolver as any, false) as any
    },
  }

  return descriptor
}

// ── Public type utilities ─────────────────────────────────────────────────────

export type InferViewShape<T extends ViewDescriptor<any, any>> =
  T extends ViewDescriptor<infer TModel, infer TSelection>
    ? InferSelectionShape<TModel["fields"] & ModelFields, TSelection>
    : never

export type InferBoundViewShape<T extends BoundViewDescriptor<any, any, any, any>> =
  T["shape"]
