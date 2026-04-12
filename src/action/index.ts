// ─── action() ─────────────────────────────────────────────────────────────────
//
// action() defines a server-side mutation.
// Schema-agnostic — any object with .parse() works (Zod, Valibot, Arktype).
//
// Four concerns, four keys:
//   input    — schema that parses and validates incoming data
//   guard    — boolean check run after validation, before execute
//   execute  — the actual mutation logic
//   onSuccess — what happens after execute resolves

import type { ResolverContext, BindContext } from "../types/index.js"
import { ValidationError, ForbiddenError } from "../errors/index.js"

// ── Schema interface — any library with .parse() qualifies ────────────────────

export type ParseSchema<TInput> = {
  parse(data: unknown): TInput
}

// ── onSuccess callback ────────────────────────────────────────────────────────

export type OnSuccessResult =
  | { redirect: string }
  | { revalidate: string[] }
  | void

export type OnSuccessFn<TResult, TServices, TSession> = (
  result:  TResult,
  ctx:     ResolverContext<TServices, TSession>,
) => OnSuccessResult | Promise<OnSuccessResult>

// ── ActionCallable — what the component receives ──────────────────────────────

export type ActionState<TResult> = {
  pending:    boolean
  error:      string | null
  fieldErrors: Record<string, string> | null
  lastResult: TResult | null
}

export type ActionCallable<TInput, TResult> = {
  (input: TInput): Promise<TResult>
  readonly pending:     boolean
  readonly error:       string | null
  readonly fieldErrors: Record<string, string> | null
  readonly lastResult:  TResult | null
}

// ── ActionDefinition — what action() returns ──────────────────────────────────

export type ActionDefinition<TInput, TResult, TServices, TSession> = {
  readonly __type:     "action"
  readonly _inputType: TInput
  readonly _result:    TResult
  // Schema — kept for client-safe import via action.inputSchema
  readonly inputSchema: ParseSchema<TInput>
  // Internal — used by the binder executor
  readonly _guard?:    ((input: TInput, ctx: ResolverContext<TServices, TSession>) => boolean | Promise<boolean>) | undefined
  readonly _execute:   (input: TInput, ctx: ResolverContext<TServices, TSession>) => Promise<TResult>
  readonly _onSuccess?: OnSuccessFn<TResult, TServices, TSession> | undefined
}

// ── ActionOptions — what the developer writes ─────────────────────────────────

export type ActionOptions<TInput, TResult, TServices, TSession> = {
  /**
   * Schema that parses and validates the raw input.
   * Any object with .parse() works — Zod, Valibot, Arktype, etc.
   */
  input: ParseSchema<TInput>

  /**
   * Optional guard — runs after validation, before execute.
   * Return false to throw ForbiddenError automatically.
   * Use for record-level ownership checks.
   * Use middleware.requireAuth() for global auth checks.
   */
  guard?: (input: TInput, ctx: ResolverContext<TServices, TSession>) => boolean | Promise<boolean>

  /**
   * The mutation itself. Runs only if guard passes.
   */
  execute: (input: TInput, ctx: ResolverContext<TServices, TSession>) => Promise<TResult>

  /**
   * Optional — what happens after execute resolves.
   * redirect: navigate to a new path (framework adapter required for v1.0.0)
   * revalidate: tag-based cache invalidation (v0.5.0 cache integration)
   * callback: arbitrary function
   */
  onSuccess?: OnSuccessFn<TResult, TServices, TSession>
}

// ── action() factory ──────────────────────────────────────────────────────────

export function action<
  TInput,
  TResult,
  TServices = unknown,
  TSession  = undefined,
>(
  options: ActionOptions<TInput, TResult, TServices, TSession>,
): ActionDefinition<TInput, TResult, TServices, TSession> {
  return {
    __type:      "action",
    _inputType:  undefined as any,
    _result:     undefined as any,
    inputSchema: options.input,
    _guard:      options.guard,
    _execute:    options.execute,
    _onSuccess:  options.onSuccess,
  }
}

// ── executeAction — called by the binder ──────────────────────────────────────

export async function executeAction<TInput, TResult, TServices, TSession>(
  definition: ActionDefinition<TInput, TResult, TServices, TSession>,
  rawInput:   unknown,
  ctx:        ResolverContext<TServices, TSession>,
): Promise<{ result: TResult; onSuccessResult: OnSuccessResult }> {
  // Step 1 — validate input
  let input: TInput
  try {
    input = definition.inputSchema.parse(rawInput)
  } catch (err: any) {
    // Normalise schema library errors into ValidationError
    const fields = extractFieldErrors(err)
    if (fields) {
      throw new ValidationError(fields)
    }
    throw new ValidationError({}, err?.message ?? "Invalid input")
  }

  // Step 2 — run guard
  if (definition._guard) {
    const allowed = await definition._guard(input, ctx)
    if (!allowed) {
      throw new ForbiddenError("Action guard rejected the request")
    }
  }

  // Step 3 — execute
  const result = await definition._execute(input, ctx)

  // Step 4 — onSuccess
  const onSuccessResult = definition._onSuccess
    ? await definition._onSuccess(result, ctx)
    : undefined

  return { result, onSuccessResult }
}

// ── Field error extraction ────────────────────────────────────────────────────
// Attempts to extract field-level errors from common schema library
// error shapes. Supports Zod, Valibot, and Yup out of the box.

function extractFieldErrors(err: any): Record<string, string> | null {
  // Zod — err.errors is an array of { path, message }
  if (Array.isArray(err?.errors) && err.errors[0]?.path !== undefined) {
    const fields: Record<string, string> = {}
    for (const issue of err.errors) {
      const key = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path)
      if (key) fields[key] = issue.message
    }
    return Object.keys(fields).length > 0 ? fields : null
  }

  // Valibot — err.issues is an array of { path, message }
  if (Array.isArray(err?.issues)) {
    const fields: Record<string, string> = {}
    for (const issue of err.issues) {
      const path = issue.path?.map((p: any) => p.key ?? p).join(".") ?? ""
      if (path) fields[path] = issue.message
    }
    return Object.keys(fields).length > 0 ? fields : null
  }

  // Yup — err.inner is an array of { path, message }
  if (Array.isArray(err?.inner) && err.inner.length > 0) {
    const fields: Record<string, string> = {}
    for (const issue of err.inner) {
      if (issue.path) fields[issue.path] = issue.message
    }
    return Object.keys(fields).length > 0 ? fields : null
  }

  return null
}

// ── InferActionInput / InferActionResult ──────────────────────────────────────

export type InferActionInput<T extends ActionDefinition<any, any, any, any>> =
  T["_inputType"]

export type InferActionResult<T extends ActionDefinition<any, any, any, any>> =
  T["_result"]
