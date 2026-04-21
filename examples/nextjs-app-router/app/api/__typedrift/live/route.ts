// examples/nextjs-app-router/app/api/__typedrift/live/route.ts
// SSE endpoint for live views.
// The adapter auto-wires this — place this file to use the default path.
// To use a custom path, call binder.liveHandler() in any route file.

import { binder } from "@/lib/binder"

export const GET = binder.liveHandler()
