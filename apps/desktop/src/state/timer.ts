import { create } from 'zustand';

export interface ActiveTimer {
  id: string;
  label: string;
  /** When the timer fires, in epoch ms. */
  target_ms: number;
  /** Original duration in seconds (for the progress ring). */
  total_seconds: number;
  /** When the user can dismiss the "fired" card. False until atlas:timer:fire arrives. */
  fired: boolean;
}

interface TimerStore {
  timers: Record<string, ActiveTimer>;
  start: (t: { id: string; label: string; target_ms: number; total_seconds: number }) => void;
  fire: (id: string) => void;
  dismiss: (id: string) => void;
}

export const useTimers = create<TimerStore>((set) => ({
  timers: {},
  start: (t) =>
    set((s) => ({
      timers: { ...s.timers, [t.id]: { ...t, fired: false } },
    })),
  fire: (id) =>
    set((s) => {
      const existing = s.timers[id];
      if (!existing) return s;
      return { timers: { ...s.timers, [id]: { ...existing, fired: true } } };
    }),
  dismiss: (id) =>
    set((s) => {
      const next = { ...s.timers };
      delete next[id];
      return { timers: next };
    }),
}));
