import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ChartData {
  /** "line" | "bar" — default "line" */
  variant?: 'line' | 'bar';
  /** Array of objects keyed by `x_key` + each series key from `series`. */
  rows?: Record<string, unknown>[];
  /** Name of the x-axis field on each row. */
  x_key?: string;
  /** Array of series field names on each row. */
  series?: string[];
  title?: string;
}

const COLORS = ['#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6'];

export function ChartArtifact({ data }: { data: unknown }) {
  const d = (data as ChartData) ?? {};
  const rows = d.rows ?? [];
  const variant = d.variant ?? 'line';
  const xKey = d.x_key ?? 'x';
  const series = d.series ?? [];

  if (rows.length === 0 || series.length === 0) {
    return <p className="text-sm text-slate-500">Empty chart.</p>;
  }

  const ChartTag = variant === 'bar' ? BarChart : LineChart;
  return (
    <div className="space-y-2">
      {d.title ? <h3 className="text-sm font-medium text-slate-100">{d.title}</h3> : null}
      <div className="rounded-md border border-slate-800 bg-slate-900/30 p-3">
        <ResponsiveContainer width="100%" height={280}>
          <ChartTag data={rows}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey={xKey} stroke="#94a3b8" fontSize={11} />
            <YAxis stroke="#94a3b8" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
            {series.map((key, i) =>
              variant === 'bar' ? (
                <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} />
              ) : (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ),
            )}
          </ChartTag>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
