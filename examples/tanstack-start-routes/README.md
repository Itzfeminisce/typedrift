# TanStack Start routes example

This example mirrors the Next.js app-router sample, but wired for file-based routes in TanStack Start.

## Files

- `lib/models.ts`: Typedrift model definitions.
- `lib/registry.ts`: Resolver registration.
- `lib/binder.ts`: Binder configuration.
- `routes/posts.$postId.tsx`: Dynamic route with typed model view binding.
- `routes/search.tsx`: Search route using `binder.raw()`.

## Notes

- Pass `params` and `searchParams` from the route into the bound component so typedrift can resolve `.from(...)` inputs.
- Replace the placeholder `db` client in `lib/binder.ts` with your actual server-side DB client.
