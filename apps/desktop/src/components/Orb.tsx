import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioLevel } from '../state/audio';
import type { CockpitState } from '../state/cockpit';

/**
 * Orb — the precision instrument at the centre of the cockpit.
 *
 * Composed of seven layered SVG dials that rotate independently like the
 * gear-train layers of a mechanical complication:
 *
 *   L0  pivot         central dot
 *   L1  core          audio-reactive deformed circle (~r=56)
 *   L2  inner dial    r=82, fine ticks every 6°
 *   L3  numbered ring r=112, Roman indices every 30°
 *   L4  major dial    r=160, alternating tall/short ticks every 5°
 *   L5  hairline      r=192, single ultra-thin circle
 *   L6  bearing ring  r=232, 12 brass bearings at clock positions
 *   L7  outer trace   r=275, sparse cardinal ticks + active marker
 *
 * State changes adjust: rotation speeds, brass-glow intensity on specific
 * layers, the active-marker behaviour on L7 (sweeps in speaking, parks in
 * listening, hides in idle).
 *
 * Ported from the reference design's `orb.jsx`. Same constants + math; the
 * only changes are TypeScript types and reading audio from our hook shape.
 */

const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
}

function useFrame(): number {
  const [t, setT] = useState(0);
  const start = useRef(performance.now());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT((performance.now() - start.current) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

// ───────────────────────── tick-mark generators ─────────────────────────

interface FineTicksProps {
  r: number;
  count: number;
  len: number;
  color: string;
  op: number;
  thick: number;
}
function FineTicks({ r, count, len, color, op, thick }: FineTicksProps) {
  const ticks = [];
  for (let i = 0; i < count; i++) {
    const deg = (i / count) * 360;
    const [x1, y1] = polar(r, deg);
    const [x2, y2] = polar(r + len, deg);
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={thick}
        strokeOpacity={op}
        strokeLinecap="butt"
      />,
    );
  }
  return <g>{ticks}</g>;
}

interface AlternatingTicksProps {
  r: number;
  count: number;
  longLen: number;
  shortLen: number;
  every: number;
  color: string;
  op: number;
}
function AlternatingTicks({ r, count, longLen, shortLen, every, color, op }: AlternatingTicksProps) {
  const ticks = [];
  for (let i = 0; i < count; i++) {
    const deg = (i / count) * 360;
    const long = i % every === 0;
    const len = long ? longLen : shortLen;
    const [x1, y1] = polar(r, deg);
    const [x2, y2] = polar(r + len, deg);
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={long ? 1.0 : 0.6}
        strokeOpacity={long ? op : op * 0.55}
        strokeLinecap="butt"
      />,
    );
  }
  return <g>{ticks}</g>;
}

interface NumberedIndicesProps {
  r: number;
  color: string;
  op: number;
  size?: number;
}
function NumberedIndices({ r, color, op, size = 9 }: NumberedIndicesProps) {
  const labels = [];
  for (let i = 0; i < 12; i++) {
    const deg = (i / 12) * 360;
    const [x, y] = polar(r, deg);
    labels.push(
      <text
        key={i}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fillOpacity={op}
        fontFamily="IBM Plex Mono, monospace"
        fontSize={size}
        fontWeight={400}
        letterSpacing="0.04em"
      >
        {ROMAN[i]}
      </text>,
    );
  }
  return <g>{labels}</g>;
}

interface BearingsProps {
  r: number;
  count: number;
  dotR: number;
  color: string;
  op: number;
  highlightIdx: number;
  glow: number;
}
function Bearings({ r, count, dotR, color, op, highlightIdx, glow }: BearingsProps) {
  const dots = [];
  for (let i = 0; i < count; i++) {
    const deg = (i / count) * 360;
    const [x, y] = polar(r, deg);
    const isHi = i === highlightIdx;
    dots.push(
      <g key={i}>
        {isHi && (
          <circle
            cx={x}
            cy={y}
            r={dotR + 3.5}
            fill="none"
            stroke={color}
            strokeWidth={0.6}
            strokeOpacity={glow}
          />
        )}
        <circle cx={x} cy={y} r={dotR} fill={color} fillOpacity={isHi ? Math.min(1, op + 0.4) : op} />
      </g>,
    );
  }
  return <g>{dots}</g>;
}

// ───────────────────────── audio-reactive core ─────────────────────────

function corePath(
  fft: Float32Array,
  level: number,
  t: number,
  baseR: number,
  breathing: boolean,
  reduced: boolean,
): string {
  const N = 64;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const bin = fft[i % fft.length] ?? 0;
    const prev = fft[(i - 1 + fft.length) % fft.length] ?? 0;
    const next = fft[(i + 1) % fft.length] ?? 0;
    const smooth = bin * 0.6 + prev * 0.2 + next * 0.2;
    const breath = breathing ? Math.sin(t * 1.2 + i * 0.4) * 0.5 : 0;
    const phase = Math.sin(t * 2.1 + i * 0.13) * 0.3;
    const deform = reduced ? 0 : smooth * 0.55 + phase * 0.05;
    const r = baseR * (1 + deform + breath * 0.012 + level * 0.18);
    const deg = (i / N) * 360;
    const [x, y] = polar(r, deg);
    pts.push([x, y]);
  }
  let d = `M ${pts[0]![0].toFixed(2)} ${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < N; i++) {
    const cur = pts[i]!;
    const nxt = pts[(i + 1) % N]!;
    const mx = (cur[0] + nxt[0]) / 2;
    const my = (cur[1] + nxt[1]) / 2;
    d += ` Q ${cur[0].toFixed(2)} ${cur[1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

function stateRotationMul(state: CockpitState): number {
  switch (state) {
    case 'idle':
      return 0.3;
    case 'wake':
      return 1.4;
    case 'listening':
      return 1.0;
    case 'thinking':
      return 2.6;
    case 'speaking':
      return 1.2;
    case 'content':
      return 0.5;
    default:
      return 0.5;
  }
}

// ───────────────────────── Orb ─────────────────────────

interface OrbProps {
  state: CockpitState;
  audio: AudioLevel;
  reduced?: boolean;
  theme?: 'dark' | 'light';
}

export function Orb({ state, audio, reduced = false, theme = 'dark' }: OrbProps) {
  const t = useFrame();
  const isDark = theme === 'dark';

  const brass = 'var(--brass)';
  const brassGlow = 'var(--brass-glow)';
  const cream = 'var(--cream)';
  const sage = 'var(--sage)';
  const hair = 'var(--hair-strong)';

  const speed = (base: number) => (reduced ? 0 : base * stateRotationMul(state));
  const r2 = t * speed(2.2);
  const r3 = -t * speed(0.9);
  const r4 = t * speed(0.55);
  const r6 = -t * speed(0.3);
  const r7 = t * speed(1.4);

  const bearingHi =
    state === 'thinking'
      ? Math.floor(t * 4) % 12
      : state === 'wake'
        ? 0
        : state === 'listening'
          ? 3
          : state === 'speaking'
            ? Math.floor(t * 1.5) % 12
            : -1;

  const markerAngle: number | null =
    state === 'speaking'
      ? (t * 60) % 360
      : state === 'thinking'
        ? (t * 180) % 360
        : state === 'listening'
          ? -12
          : state === 'wake'
            ? 0
            : null;

  const baseGlow =
    ({
      idle: 0.18,
      wake: 0.85,
      listening: 0.55,
      thinking: 0.4,
      speaking: 0.65,
      content: 0.22,
    } as Record<CockpitState, number>)[state] ?? 0.2;
  const glow = reduced ? Math.min(0.45, baseGlow) : baseGlow;

  const coreBaseR =
    ({
      idle: 52,
      wake: 58,
      listening: 60,
      thinking: 50,
      speaking: 62,
      content: 50,
    } as Record<CockpitState, number>)[state] ?? 52;

  const d = useMemo(
    () => corePath(audio.fft, audio.level, t, coreBaseR, state === 'idle' || state === 'content', reduced),
    [audio.fft, audio.level, t, coreBaseR, state, reduced],
  );

  const coreFill =
    ({
      idle: brass,
      wake: brassGlow,
      listening: sage,
      thinking: 'transparent',
      speaking: cream,
      content: brass,
    } as Record<CockpitState, string>)[state] ?? brass;
  const coreStroke = state === 'thinking' ? brass : 'transparent';
  const coreOp = state === 'thinking' ? 0 : 0.85 + (state === 'speaking' ? 0.12 : 0);

  const wakePulse = state === 'wake' ? 1 + Math.sin(Math.min(t * 6, Math.PI)) * 0.08 : 1;

  return (
    <svg
      viewBox="-300 -300 600 600"
      width="100%"
      height="100%"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="orb-wash" cx="0" cy="0" r="0.6" fx="0" fy="0">
          <stop
            offset="0%"
            stopColor={isDark ? '#3A2E1A' : '#C9A04F'}
            stopOpacity={isDark ? 0.18 : 0.08}
          />
          <stop offset="60%" stopColor={isDark ? '#1F1810' : '#E5DCC8'} stopOpacity={0} />
        </radialGradient>
        <filter id="brass-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={state === 'wake' ? 4 : 2.4} result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx="0" cy="0" r="300" fill="url(#orb-wash)" />

      {/* L7 — outer trace */}
      <g transform={`rotate(${r7}) scale(${wakePulse})`}>
        <circle cx="0" cy="0" r="275" fill="none" stroke={brass} strokeOpacity={0.18} strokeWidth={0.5} />
        <FineTicks r={272} count={4} len={6} color={brass} op={0.7} thick={1.0} />
        <FineTicks r={272} count={72} len={3} color={cream} op={0.1} thick={0.4} />
      </g>
      {markerAngle !== null && (
        <g transform={`rotate(${markerAngle})`}>
          <g filter="url(#brass-glow)">
            <line
              x1="0"
              y1="-262"
              x2="0"
              y2="-282"
              stroke={brassGlow}
              strokeWidth={1.4}
              strokeOpacity={glow + 0.2}
            />
            <circle cx="0" cy="-275" r="2.2" fill={brassGlow} fillOpacity={glow + 0.2} />
          </g>
        </g>
      )}

      {/* L6 — bearings */}
      <g transform={`rotate(${r6})`}>
        <circle cx="0" cy="0" r="232" fill="none" stroke={hair} strokeWidth={0.6} />
        <Bearings r={232} count={12} dotR={2.2} color={brass} op={0.42} highlightIdx={bearingHi} glow={glow + 0.2} />
      </g>

      {/* L5 — hairline */}
      <circle cx="0" cy="0" r="192" fill="none" stroke={cream} strokeOpacity={0.1} strokeWidth={0.4} />

      {/* L4 — major dial */}
      <g transform={`rotate(${r4})`}>
        <circle cx="0" cy="0" r="160" fill="none" stroke={brass} strokeOpacity={0.16} strokeWidth={0.5} />
        <AlternatingTicks r={160} count={72} longLen={9} shortLen={4} every={6} color={brass} op={0.55} />
      </g>

      {/* L3 — numbered indices */}
      <g transform={`rotate(${r3})`}>
        <circle cx="0" cy="0" r="112" fill="none" stroke={cream} strokeOpacity={0.05} strokeWidth={0.4} />
        <NumberedIndices r={128} color={cream} op={0.35} size={9.5} />
        <FineTicks r={112} count={60} len={3} color={cream} op={0.18} thick={0.5} />
      </g>

      {/* L2 — inner dial */}
      <g transform={`rotate(${r2})`}>
        <circle cx="0" cy="0" r="82" fill="none" stroke={cream} strokeOpacity={0.1} strokeWidth={0.4} />
        <FineTicks r={82} count={60} len={4} color={brass} op={0.32} thick={0.5} />
      </g>

      {/* Core — audio-reactive */}
      <g filter={state === 'wake' || state === 'speaking' ? 'url(#brass-glow)' : undefined}>
        <path d={d} fill={coreFill} fillOpacity={coreOp} stroke={coreStroke} strokeWidth={1} strokeOpacity={0.6} />
        {state === 'thinking' && (
          <path d={d} fill="none" stroke={brass} strokeOpacity={0.85} strokeWidth={1.1} />
        )}
        <circle cx="0" cy="0" r="2.4" fill={isDark ? cream : '#14110E'} fillOpacity={0.9} />
        <circle cx="0" cy="0" r="5.5" fill="none" stroke={brass} strokeOpacity={0.7} strokeWidth={0.5} />
      </g>

      {state === 'wake' && (
        <circle
          cx="0"
          cy="0"
          r={60 + Math.min(t, 1.0) ** 0.5 * 220}
          fill="none"
          stroke={brassGlow}
          strokeOpacity={Math.max(0, 0.5 - t * 0.5)}
          strokeWidth={1.2}
        />
      )}
    </svg>
  );
}
