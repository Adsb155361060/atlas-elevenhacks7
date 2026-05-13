/**
 * Telemetry corners — four densely-packed mono-spaced data blocks at the
 * corners of the cockpit. Functional density, not decoration. Reads like a
 * sextant log or a control-room HUD, not a typical app UI.
 *
 * Per the reference design:
 *   TL: Jarvvis brand + time/session/uptime/state
 *   TR: log/coord/target/latency/model
 *   BL: audio/source/gain/noise + waveform bars
 *   BR: build/thermal/mem/net/attn
 *
 * Atlas adapts these to its real session data (state, transcripts, etc.)
 * but keeps a few cosmetic constants (model name, build version) for
 * authentic instrument feel.
 */

import { useEffect, useRef, useState } from 'react';
import type { CockpitState } from '../../state/cockpit';
import type { AudioLevel } from '../../state/audio';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function useClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useUptime(): number {
  const start = useRef(performance.now());
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((performance.now() - start.current) / 1000), 1000);
    return () => window.clearInterval(id);
  }, []);
  return t;
}

interface MouseCoord {
  x: number;
  y: number;
}

export function useMouseCoord(): MouseCoord {
  const [m, setM] = useState<MouseCoord>({ x: 0.5, y: 0.5 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setM({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return m;
}

interface PipProps {
  on?: boolean;
  color?: string;
}

function Pip({ on = false, color = 'var(--brass)' }: PipProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: 999,
        background: on ? color : 'transparent',
        border: `1px solid ${color}`,
        marginRight: 8,
        verticalAlign: 'middle',
        transform: 'translateY(-1px)',
      }}
    />
  );
}

// ───────────────────────── TL — brand, time, session, state ─────────────────────────

interface TLProps {
  state: CockpitState;
  sessionId: string;
  conversationId?: string | null;
}

export function TLCorner({ state, sessionId, conversationId }: TLProps) {
  const now = useClock();
  const up = useUptime();
  const hh = pad(Math.floor(up / 3600));
  const mm = pad(Math.floor((up % 3600) / 60));
  const ss = pad(Math.floor(up % 60));
  const date = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  const sessionDisplay = conversationId
    ? conversationId.replace(/^conv_/, '').slice(0, 8).toUpperCase()
    : sessionId;
  return (
    <div className="mono telemetry tl" aria-hidden="true">
      <div className="row title">
        <span className="serif brand">Atlas</span>
        <span className="sep">·</span>
        <span>
          <Pip on color="var(--sage)" />
          SYS&nbsp;LIVE
        </span>
      </div>
      <div className="row">
        <span className="lbl">TIME UTC</span>
        <span className="val">
          {date}&nbsp;&nbsp;{time}
        </span>
      </div>
      <div className="row">
        <span className="lbl">SESSION</span>
        <span className="val">0x{sessionDisplay}</span>
      </div>
      <div className="row">
        <span className="lbl">UPTIME</span>
        <span className="val">
          {hh}:{mm}:{ss}
        </span>
      </div>
      <div className="row">
        <span className="lbl">STATE</span>
        <span className="val brass">{state.toUpperCase()}</span>
      </div>
    </div>
  );
}

// ───────────────────────── TR — coord, target, latency, model ─────────────────────────

interface TRProps {
  state: CockpitState;
  audio: AudioLevel;
  mouse: MouseCoord;
  model: string;
}

const TARGET_MAP: Record<CockpitState, string> = {
  idle: 'STANDBY',
  wake: 'ACQUIRING',
  listening: 'INPUT · USER',
  thinking: 'COMPUTE · CLOUD',
  speaking: 'OUTPUT · TTS',
  content: 'RENDER · CANVAS',
};

export function TRCorner({ state, audio, mouse, model }: TRProps) {
  const col = 'ABCDEFGHJKLMNPQR'[Math.min(15, Math.floor(mouse.x * 16))]!;
  const row = pad(Math.min(9, Math.max(1, Math.floor(mouse.y * 9) + 1)));
  return (
    <div className="mono telemetry tr" aria-hidden="true">
      <div className="row title">
        <span className="lbl">LOG</span>
        <span className="val">2026·Q2</span>
      </div>
      <div className="row">
        <span className="lbl">COORD</span>
        <span className="val">
          {col}·{row}
        </span>
      </div>
      <div className="row">
        <span className="lbl">TARGET</span>
        <span className="val brass">{TARGET_MAP[state]}</span>
      </div>
      <div className="row">
        <span className="lbl">LATENCY</span>
        <span className="val">{Math.round(34 + audio.level * 60)} MS</span>
      </div>
      <div className="row">
        <span className="lbl">MODEL</span>
        <span className="val">{model}</span>
      </div>
    </div>
  );
}

// ───────────────────────── BL — audio, gain, waveform ─────────────────────────

interface WaveformBarsProps {
  fft: Float32Array;
  color?: string;
  height?: number;
}

function WaveformBars({ fft, color = 'var(--brass)', height = 18 }: WaveformBarsProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        gap: 2,
        height,
        marginLeft: 8,
        verticalAlign: 'middle',
      }}
    >
      {Array.from({ length: 16 }).map((_, i) => {
        const v = Math.max(0.05, fft[i] ?? 0);
        return (
          <span
            key={i}
            style={{
              width: 2,
              height: Math.max(1.5, v * height),
              background: color,
              opacity: 0.65,
            }}
          />
        );
      })}
    </span>
  );
}

interface BLProps {
  audio: AudioLevel;
  source: string;
}

export function BLCorner({ audio, source }: BLProps) {
  const gain = (-12 + audio.level * 18).toFixed(1);
  const sourceLabel =
    source === 'session' ? 'MIC · DEFAULT' : source === 'simulated' ? 'SIM · OSC-A' : 'INACTIVE';
  return (
    <div className="mono telemetry bl" aria-hidden="true">
      <div className="row title">
        <span className="lbl">AUDIO</span>
        <span className="val">48 KHZ&nbsp;·&nbsp;16 BIT</span>
      </div>
      <div className="row">
        <span className="lbl">SOURCE</span>
        <span className="val">{sourceLabel}</span>
      </div>
      <div className="row">
        <span className="lbl">GAIN</span>
        <span className="val">{gain} DB</span>
      </div>
      <div className="row">
        <span className="lbl">NOISE</span>
        <span className="val">−68 DB</span>
      </div>
      <div className="row wave">
        <span className="lbl">WAVE</span>
        <WaveformBars fft={audio.fft} />
      </div>
    </div>
  );
}

// ───────────────────────── BR — build, thermal, mem, net, attn ─────────────────────────

interface BRProps {
  state: CockpitState;
  version: string;
}

export function BRCorner({ state, version }: BRProps) {
  const attn =
    state === 'listening' ? 'USER' : state === 'speaking' ? 'OUTPUT' : 'AMBIENT';
  return (
    <div className="mono telemetry br" aria-hidden="true">
      <div className="row title">
        <span className="lbl">BUILD</span>
        <span className="val">v{version}</span>
      </div>
      <div className="row">
        <span className="lbl">THERMAL</span>
        <span className="val brass">NOMINAL</span>
      </div>
      <div className="row">
        <span className="lbl">MEM</span>
        <span className="val">12.4 / 128 GB</span>
      </div>
      <div className="row">
        <span className="lbl">NET</span>
        <span className="val">
          <Pip on color="var(--sage)" />
          LINK 2.4 GBPS
        </span>
      </div>
      <div className="row">
        <span className="lbl">ATTN</span>
        <span className="val">{attn}</span>
      </div>
    </div>
  );
}
