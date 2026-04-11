
# Typedrift v1 Spec

## 1. Purpose

Typedrift is a React server-side data library that eliminates duplicated read declarations by making a model-native typed view the single contract for both data fetching and component props.

It is:

reads-only
React-first
RSC-compatible
server-executed
minimal by design

It is not a framework, ORM, cache system, mutation system, or transport layer.

---

## 2. Core Thesis

React read requirements are usually declared twice:

once in component props
once in a fetch/query layer

These drift.

Typedrift replaces that with a single declarative contract:

`model()` defines the resolvable graph
`view()` defines the component-sized read shape
`bind()` executes that view on the server and injects typed props

For dynamic or non-model-friendly reads, `raw()` exists as an escape hatch.

---

## 3. Non-Goals for v1

Out of scope:

mutations
optimistic UI
subscriptions / realtime
transactions / queues / cron / webhooks
auth abstractions
business logic abstractions
pagination/filter/sort arguments in `view()`
compiler plugins / AST extraction
client-side caching and invalidation
non-React targets

This is a narrow read-side library.

---

## 4. Public Surface

### Top-level exports

```ts
import {
  model,
  field,
  ref,
  createRegistry,
  createBinder,
} from "typedrift"

Model-scoped methods
	•	model(...).view(...)

View-scoped methods
	•	view.from(...)

Binder methods
	•	binder.bind(...)
	•	binder.raw(...)
```
Core Concepts

Model

A structural, resolvable graph definition.

View

A static, typed, executable subshape derived from a model.

Bound view

A view plus a root input resolver via .from(...).

Registry

A runtime container mapping models and relation edges to resolvers.

Binder

The app integration boundary that combines registry, request context, and services into server execution.

Raw

A binder-scoped escape hatch for custom server reads that bypass model/view derivation.

Model API

Purpose

model() defines:
	•	scalar fields
	•	relations
	•	runtime metadata needed for execution
	•	the base graph from which views are created

It does not fetch data and does not know React.

Example
```ts
const User = model("User", {
  id: field.id(),
  name: field.string(),
  avatarUrl: field.string().nullable(),
})

const Post = model("Post", {
  id: field.id(),
  title: field.string(),
  publishedAt: field.date(),
  author: ref(User),
})
```
Field kinds in v1

Only two field categories exist:
	•	scalar fields
	•	relation fields

Scalar examples
```ts
field.id()
field.string()
field.number()
field.boolean()
field.date()

Scalar modifiers

field.string().nullable()
```
Relation examples
```ts
ref(User)
ref(User).nullable()
ref(Comment).list()
```
Rules
	•	every model must have an id field for runtime identity
	•	scalar nullability is supported
	•	single relations may be nullable
	•	list relations are arrays and default to empty arrays
	•	list items are never nullable in v1

View API

Purpose

view() creates the single read contract that powers both:
	•	prop typing
	•	server-side selection execution

Shape
```ts
const PostCardData = Post.view({
  title: true,
  author: {
    name: true,
    avatarUrl: true,
  },
})
```
Selection rules

In v1, a view object may contain only:
	•	true for scalar fields
	•	nested objects for relation fields

Valid
```ts
Post.view({
  title: true,
  author: {
    name: true,
  },
})
```
Invalid
```ts
Post.view({
  title: false,
})

Post.view({
  author: true,
})

Post.view({
  nope: true,
})
```
Why relation fields require nested objects

A relation cannot be selected as true because that would make semantics ambiguous:
	•	full relation?
	•	only id?
	•	default fields?

So in v1:
	•	scalar field => true
	•	relation field => nested object

Shape inference

type PostCardShape = typeof PostCardData.shape

Inferred:
```ts
{
  title: string
  author: {
    name: string
    avatarUrl: string | null
  }
}
```
Nullability rules

Nullable scalar
```ts
field.string().nullable() -> string | null

Nullable single relation

ref(User).nullable()

selected as:

Post.view({
  editor: {
    name: true,
  },
})
```
becomes:
```ts
{
  editor: {
    name: string
  } | null
}
```
List relation
```ts
ref(Comment).list()
```
selected as:
```ts
Post.view({
  comments: {
    body: true,
  },
})
```
becomes:
```ts
{
  comments: Array<{
    body: string
  }>
}
```
id behavior
	•	id is explicit in public view shape
	•	runtime may use identity internally even if id is not selected
	•	unselected id must not appear in shape

Restrictions in v1

Not supported in view():
	•	filters
	•	sorting
	•	pagination
	•	runtime arguments
	•	aliases
	•	computed fields
	•	unions / polymorphism
	•	view composition
	•	empty views

Post.view({})

is invalid.

Bound Views with .from()

Purpose

A view defines shape, but not which root record to load.

.from() attaches a root input resolver.

Example
```ts
const BoundPost = PostCardData.from(({ params }) => ({
  id: params.postId!,
}))
```
.from() contract
	•	runs at server request time
	•	receives BindContext
	•	returns the canonical root input for that model
	•	does not fetch data itself

Root input policy in v1

Each model registry has one canonical root input shape.

Example:
if Post root resolver expects:
```ts
{ id: string }
```
then every .from(...) bound to Post must return that shape.

Nullable roots
```ts
const MaybePost = PostCardData
  .from(({ params }) => ({ id: params.postId! }))
  .nullable()
```
Registry API

Purpose

Maps model graph to runtime execution:
	•	root resolution
	•	relation resolution

Creation
```ts
const registry = createRegistry<AppServices>()
```
Registration
```ts
registry.register(Post, {
  root: async ({ id }: { id: string }, ctx, meta) => {
    return ctx.services.db.post.findUnique({
      where: { id },
    })
  },

  relations: {
    author: async (posts, ctx, meta) => {
      const users = await ctx.services.db.user.findMany({
        where: {
          id: { in: posts.map((p) => p.authorId) },
        },
      })

      const byId = new Map(users.map((u) => [u.id, u]))

      return new Map(
        posts.map((p) => [p.id, byId.get(p.authorId) ?? null])
      )
    },
  },
})
```
Resolver contracts
```ts
type RootResolver<TInput, TEntity, TServices> = (
  input: TInput,
  ctx: ResolverContext<TServices>,
  meta: { selection: SelectionTree }
) => Promise<TEntity | null>

type RelationResolver<TParent, TValue, TServices> = (
  parents: TParent[],
  ctx: ResolverContext<TServices>,
  meta: { selection: SelectionTree }
) => Promise<Map<string, TValue>>

ResolverContext

type ResolverContext<TServices> = {
  bind: BindContext
  services: TServices
}
```
Rules
	•	root resolver required only for root bindings
	•	relation resolver required only when selected
	•	relation resolvers belong to parent model
	•	resolvers return internal entities (not view shape)

BindContext
```ts
type BindContext = {
  params: Record<string, string | undefined>
  searchParams: Record<string, string | string[] | undefined>
  request?: Request
  runtime?: unknown
}
```
Binder API

Creation
```ts
const binder = createBinder({
  registry,
  getServices: async (ctx) => ({
    db,
  }),
})
```
Options
```ts
type CreateBinderOptions<TServices> = {
  registry: Registry<TServices>
  getServices: (ctx: BindContext) => TServices | Promise<TServices>
}
```
bind() API

Example
```ts
export default binder.bind(Page, {
  post: PostCardData.from(({ params }) => ({
    id: params.postId!,
  })),
})
```
Behavior
	•	injects bound props
	•	preserves extra props
	•	prevents manual override of bound props

Execution flow
normalize context
get services (once)
resolve inputs
execute views
execute raw sources
assemble shape
render component

raw() API

Purpose

Escape hatch for dynamic or non-model reads.

Example
```ts
const SearchResults = binder.raw(async ({ bind, services }) => {
  const q = typeof bind.searchParams.q === "string" ? bind.searchParams.q : ""

  return services.db.post.findMany({
    where: { title: { contains: q } },
    select: { id: true, title: true },
  })
})
```
Usage
```ts
export default binder.bind(Page, {
  results: SearchResults,
})
```
RawContext
```ts
type RawContext<TServices> = {
  bind: BindContext
  services: TServices
}
```
Rules
	•	server-only
	•	root-binding-only
	•	bypasses model/view/resolver
	•	type inferred from return value
	•	no .from()

Mental Model
define model
define view
attach .from()
register resolvers
create binder
use bind()
use raw() only when needed

Final Statement

Typedrift v1 makes a model-native typed view the single source of truth for React server-side reads, executes it through explicit resolvers, and injects the exact resulting shape into components as typed props.


