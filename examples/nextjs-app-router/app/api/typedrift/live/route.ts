// examples/nextjs-app-router/app/api/typedrift/live/route.ts
// SSE endpoint for live views.
// Use a public App Router segment so the route is actually reachable.
// To use a custom path, call binder.liveHandler() in any route file.

import { binder } from "@/lib/binder"

export const GET = binder.liveHandler()
