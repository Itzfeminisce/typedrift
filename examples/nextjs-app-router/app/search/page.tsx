import { binder } from "../../lib/binder"
import type { InferProps } from "typedrift"

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

function SearchPage({ results }: Props) {
  return (
    <section>
      <h1>Search results</h1>
      {results.length === 0
        ? <p>Nothing found.</p>
        : <ul>{results.map(p => <li key={p.id}>{p.title}</li>)}</ul>}
    </section>
  )
}

export default binder.bind(SearchPage, { results: SearchResults })
