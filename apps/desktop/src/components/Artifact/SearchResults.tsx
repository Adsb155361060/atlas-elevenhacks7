interface SearchResultsData {
  results?: Array<{ title: string; url: string; snippet: string }>;
  query?: string;
}

export function SearchResultsArtifact({ data }: { data: unknown }) {
  const d = (data as SearchResultsData) ?? {};
  const results = d.results ?? [];
  if (results.length === 0) {
    return <p className="text-sm text-slate-500">No results.</p>;
  }
  return (
    <div className="space-y-3">
      {d.query ? (
        <p className="text-xs uppercase tracking-widest text-slate-500">
          results for "{d.query}"
        </p>
      ) : null}
      <ul className="space-y-3">
        {results.map((r, i) => (
          <li key={i} className="border-l-2 border-emerald-500/40 pl-3">
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-medium text-slate-100 hover:text-emerald-300 transition-colors line-clamp-1"
            >
              {r.title}
            </a>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 font-mono">{r.url}</p>
            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{r.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
