// ─── Field descriptors ────────────────────────────────────────────────────────

export type ScalarKind = "id" | "string" | "number" | "boolean" | "date"
export type FieldKind = ScalarKind | "relation"
export type RelationCardinality = "one" | "many"

// ── Scalar descriptor ─────────────────────────────────────────────────────────

export type ScalarDescriptor<
  TKind extends ScalarKind,
  TNullable extends boolean = false,
> = {
  readonly __type: "scalar"
  readonly kind: TKind
  readonly _nullable: TNullable
  nullable(): ScalarDescriptor<TKind, true>
}

function makeScalar<TKind extends ScalarKind, TNullable extends boolean>(
  kind: TKind,
  _nullable: TNullable,
): ScalarDescriptor<TKind, TNullable> {
  return {
    __type: "scalar",
    kind,
    _nullable,
    nullable() {
      return makeScalar(kind, true)
    },
  }
}

// ── Relation descriptor ───────────────────────────────────────────────────────

export type AnyModelDescriptor = {
  readonly __type: "model"
  readonly name: string
  readonly fields: Record<string, AnyFieldDescriptor>
}

export type AnyFieldDescriptor =
  | ScalarDescriptor<ScalarKind, boolean>
  | RelationDescriptor<AnyModelDescriptor, RelationCardinality, boolean>

export type RelationDescriptor<
  TModel extends AnyModelDescriptor,
  TCardinality extends RelationCardinality = "one",
  TNullable extends boolean = false,
> = {
  readonly __type: "relation"
  readonly model: TModel
  readonly cardinality: TCardinality
  readonly _nullable: TNullable
  nullable(): RelationDescriptor<TModel, TCardinality, true>
  list(): RelationDescriptor<TModel, "many", false>
}

function makeRelation<
  TModel extends AnyModelDescriptor,
  TCardinality extends RelationCardinality,
  TNullable extends boolean,
>(
  model: TModel,
  cardinality: TCardinality,
  _nullable: TNullable,
): RelationDescriptor<TModel, TCardinality, TNullable> {
  return {
    __type: "relation",
    model,
    cardinality,
    _nullable,
    nullable() {
      return makeRelation(model, cardinality, true)
    },
    list() {
      return makeRelation(model, "many" as const, false)
    },
  }
}

// ── Public field builders ─────────────────────────────────────────────────────

export const field = {
  id():      ScalarDescriptor<"id",      false> { return makeScalar("id",      false) },
  string():  ScalarDescriptor<"string",  false> { return makeScalar("string",  false) },
  number():  ScalarDescriptor<"number",  false> { return makeScalar("number",  false) },
  boolean(): ScalarDescriptor<"boolean", false> { return makeScalar("boolean", false) },
  date():    ScalarDescriptor<"date",    false> { return makeScalar("date",    false) },
}

export function ref<TModel extends AnyModelDescriptor>(
  model: TModel,
): RelationDescriptor<TModel, "one", false> {
  return makeRelation(model, "one", false)
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isScalarDescriptor(
  f: AnyFieldDescriptor,
): f is ScalarDescriptor<ScalarKind, boolean> {
  return f.__type === "scalar"
}

export function isRelationDescriptor(
  f: AnyFieldDescriptor,
): f is RelationDescriptor<AnyModelDescriptor, RelationCardinality, boolean> {
  return f.__type === "relation"
}

// ── Shape inference ───────────────────────────────────────────────────────────

type ScalarRuntimeType<TKind extends ScalarKind> =
  TKind extends "id"      ? string  :
  TKind extends "string"  ? string  :
  TKind extends "number"  ? number  :
  TKind extends "boolean" ? boolean :
  TKind extends "date"    ? Date    :
  never

export type InferScalarShape<T extends ScalarDescriptor<any, any>> =
  T extends ScalarDescriptor<infer TKind, infer TNullable>
    ? TNullable extends true
      ? ScalarRuntimeType<TKind> | null
      : ScalarRuntimeType<TKind>
    : never
