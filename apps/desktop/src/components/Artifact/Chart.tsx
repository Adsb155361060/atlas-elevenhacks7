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

const COLORS = ['#c9a04f', '#8fae9f', '#e8c77a', '#b85841', '#5c7a6b'];

export function ChartArtifact({ data }: { data: unknown }) {
  const d = (data as ChartData) ?? {};
  const rows = d.rows ?? [];
  const variant = d.variant ?? 'line';
  const xKey = d.x_key ?? 'x';
  const series = d.series ?? [];

  if (rows.length === 0 || series.length === 0) {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-faint)' }}
      >
        Empty chart
      </p>
    );
  }

  const ChartTag = variant === 'bar' ? BarChart : LineChart;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {d.title ? (
        <h3
          className="serif"
          style={{
            margin: 0,
            fontSize: 18,
            fontStyle: 'italic',
            color: 'var(--cream)',
            fontVariationSettings: '"opsz" 36, "SOFT" 30',
          }}
        >
          {d.title}
        </h3>
      ) : null}
      <div
        style={{
          border: '1px solid var(--hair-strong)',
          background: 'rgba(20, 17, 14, 0.65)',
          padding: 14,
        }}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ChartTag data={rows}>
            <CartesianGrid stroke="rgba(244, 239, 230, 0.08)" strokeDasharray="3 3" />
            <XAxis dataKey={xKey} stroke="#8a8377" fontSize={11} />
            <YAxis stroke="#8a8377" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: '#14110e',
                border: '1px solid rgba(244, 239, 230, 0.16)',
                fontSize: 12,
                color: '#f4efe6',
                fontFamily: 'IBM Plex Mono',
              }}
              cursor={{ stroke: 'rgba(201, 160, 79, 0.3)' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#c8c0b2', fontFamily: 'IBM Plex Mono' }} />
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
