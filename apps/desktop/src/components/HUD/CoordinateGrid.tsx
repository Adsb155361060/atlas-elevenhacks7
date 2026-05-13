/**
 * 16×9 grid of crosshair dots layered behind everything else. Opacity is
 * state-driven (see GRID_OPACITY in App.tsx) so the cockpit feels denser
 * mid-conversation and quieter at rest. Always present, never decorative.
 */
interface CoordinateGridProps {
  opacity: number;
}

export function CoordinateGrid({ opacity }: CoordinateGridProps) {
  const cols = 16;
  const rows = 9;
  const dots = [] as JSX.Element[];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * 100;
      const y = ((r + 0.5) / rows) * 100;
      const long = c % 4 === 0 && r % 2 === 0;
      dots.push(
        <g key={`${c}-${r}`} transform={`translate(${x}% ${y}%)`}>
          <line
            x1={-3}
            y1={0}
            x2={3}
            y2={0}
            stroke="var(--cream)"
            strokeOpacity={long ? 0.55 : 0.35}
            strokeWidth={long ? 0.7 : 0.4}
          />
          <line
            x1={0}
            y1={-3}
            x2={0}
            y2={3}
            stroke="var(--cream)"
            strokeOpacity={long ? 0.55 : 0.35}
            strokeWidth={long ? 0.7 : 0.4}
          />
        </g>,
      );
    }
  }
  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        transition: 'opacity 800ms ease',
        pointerEvents: 'none',
      }}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {dots}
    </svg>
  );
}

interface GridLabelsProps {
  opacity: number;
  focusCol: number;
  focusRow: number;
}

export function GridLabels({ opacity, focusCol, focusRow }: GridLabelsProps) {
  const cols = 'ABCDEFGHJKLMNPQR'.split('').slice(0, 16);
  const rows = Array.from({ length: 9 }, (_, i) => i + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div
      className="mono"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 800ms ease',
        color: 'var(--cream-mute)',
        fontSize: 10,
        letterSpacing: '0.18em',
      }}
      aria-hidden="true"
    >
      {cols.map((c, i) => (
        <div
          key={`c${c}`}
          style={{
            position: 'absolute',
            left: `${((i + 0.5) / 16) * 100}%`,
            top: 12,
            transform: 'translateX(-50%)',
            color: i === focusCol ? 'var(--brass)' : undefined,
            opacity: i === focusCol ? 1 : 0.7,
          }}
        >
          {c}
        </div>
      ))}
      {rows.map((r, i) => (
        <div
          key={`r${r}`}
          style={{
            position: 'absolute',
            top: `${((i + 0.5) / 9) * 100}%`,
            left: 12,
            transform: 'translateY(-50%)',
            color: i === focusRow ? 'var(--brass)' : undefined,
            opacity: i === focusRow ? 1 : 0.7,
          }}
        >
          {pad(r)}
        </div>
      ))}
    </div>
  );
}
