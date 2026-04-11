// ─── Model ────────────────────────────────────────────────────────────────────

import {
  type AnyFieldDescriptor,
  type ScalarDescriptor,
  type RelationDescriptor,
  type ScalarKind,
  type RelationCardinality,
  type AnyModelDescriptor,
  isScalarDescriptor,
  isRelationDescriptor,
} from "../field/index.js"
import { createView } from "../view/index.js"

// ── Field shape inference ─────────────────────────────────────────────────────

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

export type ModelFields = Record<string, AnyFieldDescriptor>

export type ViewSelection<TFields extends ModelFields> = {
  [K in keyof TFields]?: TFields[K] extends ScalarDescriptor<any, any>
    ? true
    : TFields[K] extends RelationDescriptor<infer TModel, any, any>
      ? TModel extends { fields: infer TRelFields extends ModelFields }
        ? ViewSelection<TRelFields>
        : never
      : never
}

export type ModelDescriptor<
  TName extends string,
  TFields extends ModelFields,
> = {
  readonly __type: "model"
  readonly name: TName
  readonly fields: TFields
  view<TSelection extends ViewSelection<TFields>>(
    selection: TSelection,
  ): import("../view/index.js").ViewDescriptor<ModelDescriptor<TName, TFields>, TSelection>
}

export function model<
  TName extends string,
  TFields extends ModelFields,
>(
  name: TName,
  fields: TFields,
): ModelDescriptor<TName, TFields> {
  if (!("id" in fields)) {
    throw new Error(
      `[typedrift] model("${name}") is missing a required "id" field.\n` +
      `Add: id: field.id()`
    )
  }

  const descriptor: ModelDescriptor<TName, TFields> = {
    __type: "model",
    name,
    fields,
    view(selection) {
      return createView(descriptor as any, selection) as any
    },
  }

  return descriptor
}

export type { AnyModelDescriptor }
