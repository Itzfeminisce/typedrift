# Changelog

## 0.1.0 — initial release

- `model()` — define resolvable data graph with scalars and relations
- `field` — scalar constructors: id, string, number, boolean, date + `.nullable()`
- `ref()` — relation constructor with `.nullable()` and `.list()`
- `Model.view()` — typed, executable subshape from a model
- `.from()` — attach root input resolver to a view
- `.nullable()` — allow null root results
- `createRegistry()` — register root and relation resolvers
- `createBinder()` — app integration boundary with service wiring
- `binder.bind()` — inject typed server props into RSC components
- `binder.raw()` — escape hatch for dynamic reads
- `InferProps` — type utility for bound component props
- ESM + CJS dual output with full `.d.ts` declarations
