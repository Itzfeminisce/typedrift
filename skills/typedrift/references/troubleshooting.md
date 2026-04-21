# Typedrift troubleshooting

Use this file when the implementation looks plausible but does not match Typedrift's model.

## Symptom: component fetches its own data

Wrong direction:

- adding `fetch()` inside the bound component
- adding `useEffect` plus local loading state for primary page data
- replacing a view descriptor with a client query hook

Fix:

- move the data contract into `Model.view(...)`
- map route input with `.from(...)`
- bind with `binder.bind(...)`

## Symptom: React Query or SWR patterns appear

Wrong direction:

- `useQuery`, `queryKey`, `queryFn`
- SWR fetchers
- client cache orchestration for data that Typedrift should resolve on the server

Fix:

- keep reads in Typedrift views and registry resolvers
- use actions for writes
- use `.live()` and `useLiveData()` for realtime behavior

## Symptom: wrong adapter import

Wrong direction:

- `createNextBinder` in TanStack Start
- `createStartBinder` in Next.js App Router

Fix:

- Next.js App Router -> `typedrift/next`
- TanStack Start -> `typedrift/start`
- custom integration -> `createBinder` from `typedrift`

## Symptom: prop types rewritten by hand

Wrong direction:

- manually typing the bound props instead of deriving them from descriptors
- copying the current shape and letting it drift from the view

Fix:

```ts
type Props = InferProps<{
  post: typeof PostData
  onVote: typeof votePost
}>
```

## Symptom: registry is incomplete

Wrong direction:

- model exists but registry registration is missing
- relation field exists but resolver is not registered

Fix:

- run `npx typedrift check`
- inspect the registry with `npx typedrift inspect`
- scaffold missing pieces with `npx typedrift generate --missing`

## Symptom: live view wrapped in custom client state

Wrong direction:

- adding a separate websocket layer for the same view
- changing the bound prop into `{ data, loading }`
- replacing Typedrift tags with ad hoc refresh plumbing

Fix:

- keep the bound prop shape unchanged
- use `.live()` on the descriptor
- use `Descriptor.useLiveData()` for connection state
- use action `onSuccess(...revalidate)` tags to fan out updates

## Symptom: middleware and guard responsibilities are blurred

Wrong direction:

- putting global auth logic into many individual actions
- putting record-specific ownership checks into generic middleware

Fix:

- middleware for cross-cutting rules
- `guard` for action-specific authorization

## Prompting rule

When writing or reviewing Typedrift code, prefer the simplest explanation that matches these primitives:

- models
- registry
- views
- binder
- actions
- live descriptors
- middleware
- CLI

If a proposed solution introduces extra client data layers, generated hooks, or non-existent Typedrift APIs, it is probably borrowing the wrong mental model.
