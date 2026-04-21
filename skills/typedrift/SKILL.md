---
name: typedrift
description: Use when working with Typedrift, a React data library where component prop types drive server-side data fetching. Covers model(), field, ref(), createRegistry(), view(), bind(), actions(), action(), batch helpers, live views, middleware, typedrift/cli, and framework adapters for Next.js and TanStack Start.
---

# Typedrift

Typedrift is not React Query, SWR, or hand-written fetch orchestration.

Use this skill when a task involves:

- `typedrift` imports
- defining `model()`, `field.*()`, or `ref()`
- registering resolvers with `createRegistry()`
- creating `view()` descriptors and binding them into components
- adding `action()` mutations or chained `.actions(...)`
- wiring `createBinder()`, `createNextBinder()`, or `createStartBinder()`
- using live views, `useLiveData()`, cache tags, or `binder.liveHandler()`
- running or configuring the Typedrift CLI

## Core workflow

The default path is:

1. Define models with `model()` and `field.*()`, and relations with `ref()`.
2. Register root and relation resolvers in `createRegistry()`.
3. Define a view with `Model.view(...).from(...)`.
4. Create a binder with `createBinder()`, `createNextBinder()`, or `createStartBinder()`.
5. Bind the component with `binder.bind(Component, { ...sources })`.
6. Add mutations with chained `.actions(...)` or `binder.actions(...)` when needed.

The mental model:

- The view descriptor is the data contract.
- The bound component receives resolved props, not loading wrappers.
- Data fetching happens on the server through the registry and binder.
- `.live()` keeps the same prop shape and adds subscription behavior, not a new data wrapper API.

## Do

- Prefer `InferProps` from the actual view and action descriptors.
- Use `batch.one`, `batch.many`, and `batch.junction` for relations.
- Use action `guard` for record-level checks and middleware for global auth or policy.
- Keep adapters straight:
  - `typedrift/next` for Next.js App Router
  - `typedrift/start` for TanStack Start
  - `typedrift` for framework-agnostic binder usage

## Do not

- Do not add `fetch()` calls inside Typedrift-bound components.
- Do not reach for `useQuery`, SWR, or client-side query hooks as the main data path.
- Do not invent APIs such as `useTypedriftQuery`, `createTypedriftClient`, or `view().query()`.
- Do not manually re-describe bound prop shapes when the descriptor already exists.
- Do not use the Next adapter in TanStack Start or the Start adapter in Next.js.

## Read next

- Read [setup.md](references/setup.md) for model, registry, binder, and import-path setup.
- Read [patterns.md](references/patterns.md) for relation batching, nullable views, feeds, and action injection patterns.
- Read [live.md](references/live.md) for `.live()`, `useLiveData()`, revalidation tags, and SSE routing.
- Read [adapters.md](references/adapters.md) when working in Next.js, TanStack Start, or framework-agnostic setups.
- Read [cli.md](references/cli.md) for `typedrift.config.ts`, `check`, `inspect`, and `generate`.
- Read [middleware.md](references/middleware.md) for auth, role checks, filters, audit, and rate limiting.
- Read [troubleshooting.md](references/troubleshooting.md) when an implementation looks plausible but feels borrowed from another data library.
