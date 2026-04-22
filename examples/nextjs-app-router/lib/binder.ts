// examples/nextjs-app-router/lib/binder.ts
import { createNextBinder }           from "typedrift/next"
import { middleware, auditMiddleware,
         rateLimitMiddleware,
         redisCacheStore }            from "typedrift"
import { registry }                   from "./registry"
import type { AppServices, AppSession } from "./types"

// import { db, redis }   from "./db"
// import { getSession }  from "./auth"
declare const db:         AppServices["db"]
declare const redis:      any
declare const getSession: (req: Request) => Promise<AppSession | undefined>

export const binder = createNextBinder<AppServices, AppSession>({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => getSession(ctx.request!),

  // Cache — Redis in production, omit store → unstable_cache for zero config
  cache: {
    store:      redisCacheStore(redis),
    defaultTtl: 60,
  },

  // Middleware — runs once per source per render
  middleware: [
    // Require auth for all sources
    middleware.requireAuth(),

    // Rate limit actions — 100 per minute per user
    rateLimitMiddleware({
      filter: "actions",
      store:  { increment: async (key, windowMs) => 1 }, // replace with redis store
      window: "1m",
      max:    100,
      key:    (ctx) => (ctx.session as AppSession | undefined)?.userId ?? "anon",
    }),

    // Audit all actions
    auditMiddleware({
      filter:  "actions",
      redact:  (entry) => ({ ...entry, input: "REDACTED" }),
      onEntry: async (entry, ctx) => {
        await ctx.services.db.auditLog.create({ data: entry })
      },
    }),
  ],
})

// Export the live SSE handler — wire into app/api/typedrift/live/route.ts
export { binder }
