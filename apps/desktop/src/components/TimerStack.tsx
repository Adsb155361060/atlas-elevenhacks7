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

/**
 * Bottom-right floating stack of countdown cards. One card per active
 * timer; auto-dismisses 8s after firing.
 */
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
      // Auto-dismiss 8s after firing so the card doesn't linger.
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
    <div className="fixed bottom-32 right-6 space-y-2 z-50">
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
    Math.max(0, ((timer.total_seconds * 1000 - (timer.target_ms - now)) / (timer.total_seconds * 1000)) * 100),
  );

  return (
    <div
      className={[
        'w-56 px-4 py-3 rounded-lg border backdrop-blur-md shadow-lg',
        timer.fired
          ? 'border-emerald-500/60 bg-emerald-950/70 animate-pulse'
          : 'border-slate-800 bg-slate-900/85',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">
          {timer.fired ? 'timer done' : 'timer'}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss timer"
          className="text-slate-500 hover:text-slate-200 text-xs leading-none"
        >
          ×
        </button>
      </div>
      <p className="mt-1.5 text-sm font-medium text-slate-100 truncate">
        {timer.label}
      </p>
      <p className="mt-1 text-2xl font-light tabular-nums text-slate-200">
        {timer.fired ? '0:00' : formatRemaining(remaining)}
      </p>
      <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
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
  // Tiny Web-Audio-API blip — three short beeps. No external assets.
  try {
    const ctx = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
