// ─── Structured error types ───────────────────────────────────────────────────
//
// TypedriftError and its subclasses are the only errors the binder catches
// and converts to structured form. All other errors propagate normally.

export type TypedriftErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL"

export type StructuredError = {
  code:    TypedriftErrorCode
  status:  number
  message: string
  fields?: Record<string, string>  // ValidationError only
}

// ── Base class ────────────────────────────────────────────────────────────────

export class TypedriftError extends Error {
  readonly code:   TypedriftErrorCode
  readonly status: number

  constructor(code: TypedriftErrorCode, status: number, message: string) {
    super(message)
    this.name   = "TypedriftError"
    this.code   = code
    this.status = status
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON(): StructuredError {
    return { code: this.code, status: this.status, message: this.message }
  }
}

// ── Subclasses ────────────────────────────────────────────────────────────────

/**
 * Throw when a requested resource does not exist.
 *
 * @example
 * throw new NotFoundError("Post", id)
 * // → { code: "NOT_FOUND", status: 404, message: "Post p1 not found" }
 */
export class NotFoundError extends TypedriftError {
  constructor(model: string, id?: string) {
    super(
      "NOT_FOUND",
      404,
      id ? `${model} ${id} not found` : `${model} not found`,
    )
    this.name = "NotFoundError"
  }
}

/**
 * Throw when the current session lacks permission for the requested operation.
 *
 * @example
 * throw new ForbiddenError("Cannot access posts from another org")
 */
export class ForbiddenError extends TypedriftError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", 403, message)
    this.name = "ForbiddenError"
  }
}

/**
 * Throw when input validation fails.
 * Carries field-level error messages.
 *
 * @example
 * throw new ValidationError({ title: "Title is required", body: "Too short" })
 */
export class ValidationError extends TypedriftError {
  readonly fields: Record<string, string>

  constructor(fields: Record<string, string>, message = "Validation failed") {
    super("VALIDATION_FAILED", 422, message)
    this.name   = "ValidationError"
    this.fields = fields
  }

  toJSON(): StructuredError {
    return {
      code:    this.code,
      status:  this.status,
      message: this.message,
      fields:  this.fields,
    }
  }
}

/**
 * Throw when a rate limit is exceeded. Added here for v0.5.0 compatibility.
 */
export class RateLimitError extends TypedriftError {
  constructor(message = "Too many requests") {
    super("RATE_LIMITED", 429, message)
    this.name = "RateLimitError"
  }
}

/**
 * Throw for unexpected server-side failures.
 */
export class InternalError extends TypedriftError {
  constructor(message = "Internal error") {
    super("INTERNAL", 500, message)
    this.name = "InternalError"
  }
}

// ── Type guard ────────────────────────────────────────────────────────────────

export function isTypedriftError(err: unknown): err is TypedriftError {
  return err instanceof TypedriftError
}
