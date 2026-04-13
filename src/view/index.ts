// ─── View — v0.2.0 ───────────────────────────────────────────────────────────

import type { SelectionTree, BindContext, QueryArgDefs, ListResult, ViewCacheConfig } from "../types/index.js"
import type { ModelFields, ViewSelection } from "../model/index.js"
import type {
  AnyModelDescriptor,
  ScalarDescriptor,
  RelationDescriptor,
  ScalarKind,
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
  TIsList extends boolean = false,
> = {
  readonly __type:     "bound-view"
  readonly view:       ViewDescriptor<TModel, TSelection>
  readonly from:       FromResolver<Record<string, unknown>>
  readonly _nullable:  TNullable
  readonly _isList:    TIsList
  nullable(): BoundViewDescriptor<TModel, TSelection, TShape, true, TIsList>
  readonly shape: TIsList extends true
    ? ListResult<TShape>
    : TNullable extends true
      ? TShape | null
      : TShape
}

// ── ViewDescriptor ────────────────────────────────────────────────────────────

export type ViewDescriptor<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
> = {
  readonly __type:       "view"
  readonly model:        TModel
  readonly selection:    TSelection
  readonly queryArgDefs: QueryArgDefs | null
  readonly selectionTree: SelectionTree
  readonly cacheConfig:  ViewCacheConfig | false | null
  readonly shape:        InferSelectionShape<TModel["fields"] & ModelFields, TSelection>

  /**
   * Mark this view as a list view — changes the resolved shape to
   * ListResult<T> and signals the root resolver to use list mode.
   */
  list(): ListViewDescriptor<TModel, TSelection>

  from<TInput extends Record<string, unknown>>(
    resolver: FromResolver<TInput>,
  ): BoundViewDescriptor<
    TModel,
    TSelection,
    InferSelectionShape<TModel["fields"] & ModelFields, TSelection>,
    false,
    false
  >
}

// ── ListViewDescriptor ────────────────────────────────────────────────────────

export type ListViewDescriptor<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
> = {
  readonly __type:        "list-view"
  readonly view:          ViewDescriptor<TModel, TSelection>
  readonly shape:         ListResult<InferSelectionShape<TModel["fields"] & ModelFields, TSelection>>

  from<TInput extends Record<string, unknown>>(
    resolver: FromResolver<TInput>,
  ): BoundViewDescriptor<
    TModel,
    TSelection,
    InferSelectionShape<TModel["fields"] & ModelFields, TSelection>,
    false,
    true
  >
}

// ── SelectionTree builder ─────────────────────────────────────────────────────

function buildSelectionTree(
  fields:    ModelFields,
  selection: Record<string, unknown>,
): SelectionTree {
  const scalars   = new Set<string>()
  const relations = new Map<string, SelectionTree>()

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
  view:      ViewDescriptor<TModel, TSelection>,
  fromFn:    FromResolver<Record<string, unknown>>,
  _nullable: boolean,
  _isList:   boolean,
): BoundViewDescriptor<TModel, TSelection, TShape, any, any> {
  return {
    __type:    "bound-view",
    view,
    from:      fromFn,
    _nullable,
    _isList,
    nullable() {
      return makeBoundView(view, fromFn, true, _isList) as any
    },
    get shape(): any {
      throw new Error("[typedrift] .shape is a compile-time type accessor only.")
    },
  }
}

// ── createView — public factory ───────────────────────────────────────────────

export function createView<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
>(
  modelDef:     TModel,
  selection:    TSelection,
  queryArgDefs?: QueryArgDefs | null,
  cacheConfig?:  ViewCacheConfig | false | null,
): ViewDescriptor<TModel, TSelection> {
  if (Object.keys(selection).length === 0) {
    throw new Error(
      `[typedrift] ${modelDef.name}.view({}) — empty views are not allowed.`
    )
  }

  const selectionTree = buildSelectionTree(
    modelDef.fields as ModelFields,
    selection as Record<string, unknown>,
  )

  const descriptor: ViewDescriptor<TModel, TSelection> = {
    __type:       "view",
    model:        modelDef,
    selection,
    queryArgDefs: queryArgDefs ?? null,
    cacheConfig:  cacheConfig ?? null,
    selectionTree,
    get shape(): any {
      throw new Error("[typedrift] .shape is a compile-time type accessor only.")
    },
    list() {
      return makeListView(descriptor)
    },
    from(resolver) {
      return makeBoundView(descriptor, resolver as any, false, false) as any
    },
  }

  return descriptor
}

// ── ListViewDescriptor factory ────────────────────────────────────────────────

function makeListView<
  TModel extends AnyModelDescriptor,
  TSelection extends ViewSelection<TModel["fields"]>,
>(
  view: ViewDescriptor<TModel, TSelection>,
): ListViewDescriptor<TModel, TSelection> {
  return {
    __type: "list-view",
    view,
    get shape(): any {
      throw new Error("[typedrift] .shape is a compile-time type accessor only.")
    },
    from(resolver) {
      return makeBoundView(view, resolver as any, false, true) as any
    },
  }
}

// ── Public type utilities ─────────────────────────────────────────────────────

export type InferViewShape<T extends ViewDescriptor<any, any>> =
  T extends ViewDescriptor<infer TModel, infer TSelection>
    ? InferSelectionShape<TModel["fields"] & ModelFields, TSelection>
    : never

export type InferBoundViewShape<T extends BoundViewDescriptor<any, any, any, any, any>> =
  T["shape"]
