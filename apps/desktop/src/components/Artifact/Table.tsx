interface TableData {
  columns?: string[];
  rows?: unknown[][];
  caption?: string;
}

export function TableArtifact({ data }: { data: unknown }) {
  const d = (data as TableData) ?? {};
  const columns = d.columns ?? [];
  const rows = d.rows ?? [];
  if (columns.length === 0 || rows.length === 0) {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-faint)' }}
      >
        Empty table
      </p>
    );
  }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--hair-strong)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(20, 17, 14, 0.7)' }}>
            {columns.map((c, i) => (
              <th
                key={i}
                className="mono"
                style={{
                  textAlign: 'left',
                  padding: '10px 14px',
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: 'var(--cream-mute)',
                  fontWeight: 500,
                  borderBottom: '1px solid var(--hair-strong)',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--hair)' }}>
              {columns.map((_, ci) => (
                <td
                  key={ci}
                  className="serif-body"
                  style={{
                    padding: '10px 14px',
                    fontSize: 13,
                    color: 'var(--cream)',
                  }}
                >
                  {formatCell(row[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {d.caption ? (
        <p
          className="serif-body"
          style={{
            margin: 0,
            padding: '8px 14px',
            fontSize: 12,
            fontStyle: 'italic',
            color: 'var(--cream-mute)',
            borderTop: '1px solid var(--hair)',
          }}
        >
          {d.caption}
        </p>
      ) : null}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
