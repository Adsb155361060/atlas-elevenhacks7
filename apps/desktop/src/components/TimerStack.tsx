import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTimers, type ActiveTimer } from '../state/timer';

interface StartEvent {
  id: string;
  label: string;
  seconds: number;
  target_ms: number;
}

interface FireEvent {
  id: string;
  label: string;
}

export function TimerStack() {
  const timers = useTimers((s) => s.timers);
  const start = useTimers((s) => s.start);
  const fire = useTimers((s) => s.fire);
  const dismiss = useTimers((s) => s.dismiss);

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    listen<StartEvent>('atlas:timer:start', (e) => {
      start({
        id: e.payload.id,
        label: e.payload.label,
        target_ms: e.payload.target_ms,
        total_seconds: e.payload.seconds,
      });
    }).then((fn) => {
      un1 = fn;
    });
    listen<FireEvent>('atlas:timer:fire', (e) => {
      fire(e.payload.id);
      playChime();
      setTimeout(() => dismiss(e.payload.id), 8000);
    }).then((fn) => {
      un2 = fn;
    });
    return () => {
      un1?.();
      un2?.();
    };
  }, [start, fire, dismiss]);

  const entries = Object.values(timers).sort((a, b) => a.target_ms - b.target_ms);
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 128,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 50,
      }}
    >
      {entries.map((t) => (
        <TimerCard key={t.id} timer={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function TimerCard({ timer, onDismiss }: { timer: ActiveTimer; onDismiss: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (timer.fired) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer.fired]);

  const remaining = Math.max(0, Math.ceil((timer.target_ms - now) / 1000));
  const pct = Math.min(
    100,
    Math.max(
      0,
      ((timer.total_seconds * 1000 - (timer.target_ms - now)) /
        (timer.total_seconds * 1000)) *
        100,
    ),
  );

  return (
    <div
      style={{
        width: 240,
        padding: '14px 18px',
        border: `1px solid ${timer.fired ? 'var(--brass)' : 'var(--hair-strong)'}`,
        background: timer.fired ? 'rgba(201, 160, 79, 0.12)' : 'rgba(20, 17, 14, 0.92)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
        animation: timer.fired ? 'atlas-pulse 1.2s ease-in-out infinite' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: timer.fired ? 'var(--brass)' : 'var(--cream-mute)',
          }}
        >
          {timer.fired ? 'Timer · done' : 'Timer'}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss timer"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--cream-mute)',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cream)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cream-mute)')}
        >
          ×
        </button>
      </div>
      <p
        className="serif"
        style={{
          margin: '8px 0 0',
          fontSize: 14,
          fontStyle: 'italic',
          color: 'var(--cream)',
          fontVariationSettings: '"opsz" 36, "SOFT" 30',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {timer.label}
      </p>
      <p
        className="mono"
        style={{
          margin: '6px 0 0',
          fontSize: 26,
          fontWeight: 300,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--cream)',
          letterSpacing: '0.04em',
        }}
      >
        {timer.fired ? '0:00' : formatRemaining(remaining)}
      </p>
      <div
        style={{
          marginTop: 10,
          height: 2,
          background: 'var(--hair-strong)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'var(--brass)',
            width: `${pct}%`,
            transition: 'width 300ms ease',
          }}
        />
      </div>
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playChime() {
  try {
    const ctx = new (window.AudioContext ||
      (window as typeof window & { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
    const t0 = ctx.currentTime;
    [0, 0.18, 0.36].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, t0 + offset);
      gain.gain.linearRampToValueAtTime(0.15, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.15);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 700);
  } catch {
    /* fall through silently */
  }
}
