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
    return <p className="text-sm text-slate-500">Empty table.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-slate-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-slate-900/60 text-slate-400 text-xs uppercase tracking-wider">
            {columns.map((c, i) => (
              <th key={i} className="text-left px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-800/60 text-slate-300">
              {columns.map((_, ci) => (
                <td key={ci} className="px-3 py-2">
                  {formatCell(row[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {d.caption ? (
        <p className="text-[11px] text-slate-500 px-3 py-2 border-t border-slate-800/60">
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
