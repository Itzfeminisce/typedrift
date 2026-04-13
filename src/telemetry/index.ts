// ─── Telemetry — v0.5.0 ──────────────────────────────────────────────────────
//
// Optional OpenTelemetry tracing. Zero overhead when not configured.
// Compatible with any OTel-compatible backend via @opentelemetry/api.

// ── Tracer interface ──────────────────────────────────────────────────────────
// Typedrift uses a minimal tracer interface so the core library does not
// depend on @opentelemetry/api directly. The openTelemetryTracer() adapter
// bridges the gap.

export type SpanAttributes = Record<string, string | number | boolean | null>

export type TypedriftSpan = {
  setAttributes(attrs: SpanAttributes): void
  setStatus(status: "ok" | "error", message?: string): void
  end(): void
}

export type TypedriftTracer = {
  startSpan(name: string, attributes?: SpanAttributes): TypedriftSpan
}

// ── OTel Span/Tracer minimal interface ───────────────────────────────────────
// Only the subset Typedrift uses — avoids hard dependency on @opentelemetry/api

type OtelSpanStatusCode = { OK: 1; ERROR: 2 }

type OtelSpan = {
  setAttributes(attrs: Record<string, unknown>): void
  setStatus(status: { code: number }, message?: string): void
  end(): void
}

type OtelTracer = {
  startActiveSpan<T>(name: string, fn: (span: OtelSpan) => T): T
  startSpan(name: string, options?: Record<string, unknown>): OtelSpan
}

/**
 * Adapt an OpenTelemetry tracer to Typedrift's TypedriftTracer interface.
 *
 * @example
 * import { trace } from "@opentelemetry/api"
 * createBinder({
 *   tracer: openTelemetryTracer(trace.getTracer("myapp", "1.0.0"))
 * })
 */
export function openTelemetryTracer(otelTracer: OtelTracer): TypedriftTracer {
  return {
    startSpan(name, attributes) {
      const span = otelTracer.startSpan(name)
      if (attributes) span.setAttributes(attributes)
      return {
        setAttributes(attrs) { span.setAttributes(attrs) },
        setStatus(status, message) {
          span.setStatus({ code: status === "ok" ? 1 : 2 }, message)
        },
        end() { span.end() },
      }
    },
  }
}

// ── Span name constants ───────────────────────────────────────────────────────

export const SpanNames = {
  VIEW:              "typedrift.view",
  RESOLVER_ROOT:     "typedrift.resolver.root",
  RESOLVER_RELATION: "typedrift.resolver.relation",
  ACTION:            "typedrift.action",
  CACHE_CHECK:       "typedrift.cache",
} as const
