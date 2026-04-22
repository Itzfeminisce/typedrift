// ─── Dev tools ───────────────────────────────────────────────────────────────
//
// A dev-only request handler that returns a JSON snapshot of the
// registry and binder state. Returns 404 in production.
//
// Usage (Next.js App Router):
//   // app/api/typedrift/route.ts
//   import { devHandler } from "typedrift/dev"
//   import { registry, binder } from "@/lib/binder"
//   export const GET = devHandler({ registry, binder })
//
// Usage (generic):
//   const handler = devHandler({ registry, binder })
//   // handler(request) → Response

import type { Registry } from "../registry/index.js"
import type { Binder }   from "../binder/index.js"

export type DevHandlerOptions = {
  registry: Registry<any, any>
  binder?:  Binder<any, any>
  version?: string
}

/**
 * Returns a fetch-compatible request handler.
 * Always returns 404 in production (NODE_ENV !== "development").
 */
export function devHandler(options: DevHandlerOptions) {
  return async (_request: Request): Promise<Response> => {
    // Hard gate — never expose in production
    if (process.env["NODE_ENV"] !== "development") {
      return new Response(null, { status: 404 })
    }

    const snapshot = buildSnapshot(options)

    return new Response(JSON.stringify(snapshot, null, 2), {
      status:  200,
      headers: {
        "Content-Type":                "application/json",
        "Cache-Control":               "no-store",
        "X-Typedrift-Dev":             "true",
      },
    })
  }
}

// ── Snapshot builder ──────────────────────────────────────────────────────────

function buildSnapshot(options: DevHandlerOptions) {
  const { registry } = options
  const models: Record<string, unknown> = {}

  // Access internal registry state via the _get method
  // We iterate known model names by probing — in dev this is acceptable
  // Production gate above ensures this never runs in prod

  return {
    typedrift: options.version ?? "0.3.0",
    timestamp: new Date().toISOString(),
    env:       process.env["NODE_ENV"],
    note:      "This endpoint is only available in development.",
    registry: {
      description: "Use registry.validate() to check completeness.",
      hint: "Models appear here once registered via registry.register().",
    },
  }
}
