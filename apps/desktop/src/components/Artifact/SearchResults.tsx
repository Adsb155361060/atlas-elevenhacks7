interface SearchResultsData {
  results?: Array<{ title: string; url: string; snippet: string }>;
  query?: string;
}

export function SearchResultsArtifact({ data }: { data: unknown }) {
  const d = (data as SearchResultsData) ?? {};
  const results = d.results ?? [];
  if (results.length === 0) {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-faint)' }}
      >
        No results
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {d.query ? (
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--brass)',
          }}
        >
          results for "{d.query}"
        </p>
      ) : null}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {results.map((r, i) => (
          <li
            key={i}
            style={{
              borderLeft: '2px solid var(--brass)',
              paddingLeft: 14,
            }}
          >
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="serif"
              style={{
                display: 'block',
                fontSize: 16,
                fontStyle: 'italic',
                color: 'var(--cream)',
                fontVariationSettings: '"opsz" 36, "SOFT" 30',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--brass)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cream)')}
            >
              {r.title}
            </a>
            <p
              className="mono"
              style={{
                margin: '4px 0 0',
                fontSize: 10,
                color: 'var(--cream-faint)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {r.url}
            </p>
            <p
              className="serif-body"
              style={{
                margin: '6px 0 0',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--cream-mute)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {r.snippet}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
