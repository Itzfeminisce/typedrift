import { createFileRoute } from "@tanstack/react-router"
import type { InferProps } from "typedrift"
import { binder } from "../lib/binder"

const SearchResults = binder.raw(async ({ bind, services }) => {
  const q = typeof bind.searchParams["q"] === "string"
    ? bind.searchParams["q"].trim()
    : ""

  if (!q) return []

  return services.db.post.findMany({
    where: { title: { contains: q, mode: "insensitive" } },
    take: 20,
  })
})

type Props = InferProps<{ results: typeof SearchResults }>

function SearchRouteView({ results }: Props) {
  return (
    <section>
      <h1>Search results</h1>
      {results.length === 0
        ? <p>Nothing found.</p>
        : <ul>{results.map(p => <li key={p.id}>{p.title}</li>)}</ul>}
    </section>
  )
}

const BoundSearchRoute = binder.bind(SearchRouteView, { results: SearchResults })

export const Route = createFileRoute("/search")({
  component: () => <BoundSearchRoute searchParams={Route.useSearch()} />,
})
