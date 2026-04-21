// examples/tanstack-start/lib/binder.ts
// One import swap from the Next.js version — everything else identical.

import { createStartBinder }         from "typedrift/start"
import { middleware, auditMiddleware,
         rateLimitMiddleware,
         redisCacheStore }           from "typedrift"
import { registry }                  from "./registry"
import type { AppServices, AppSession } from "./types"

declare const db:         AppServices["db"]
declare const redis:      any
declare const getSession: (req: Request) => Promise<AppSession | undefined>

export const binder = createStartBinder<AppServices, AppSession>({
  registry,
  getServices: async () => ({ db }),
  getSession:  async (ctx) => getSession(ctx.request!),

  // Note: TanStack Start has no unstable_cache equivalent
  // Omit store → memoryCacheStore() for dev, add Redis for production
  cache: {
    store:      redisCacheStore(redis),
    defaultTtl: 60,
  },

  middleware: [
    middleware.requireAuth(),

    rateLimitMiddleware({
      filter: "actions",
      store:  { increment: async () => 1 }, // replace with redis store
      window: "1m",
      max:    100,
      key:    (ctx) => (ctx.session as AppSession | undefined)?.userId ?? "anon",
    }),

    auditMiddleware({
      filter:  "actions",
      redact:  (entry) => ({ ...entry, input: "REDACTED" }),
      onEntry: async (entry, ctx) => {
        await ctx.services.db.auditLog.create({ data: entry })
      },
    }),
  ],
})
