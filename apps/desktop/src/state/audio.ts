import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { CockpitState } from './cockpit';

/**
 * useAudioLevel — unified audio amplitude source for the Orb + HUD waveform.
 *
 * Two backends:
 *  - **session**: when the voice loop is running, the Rust side emits
 *    `voice:vad` events with the agent's VAD score 0..1. We smooth that
 *    into a level and synthesise a plausible 32-bin FFT so the Orb's core
 *    deforms in time with the actual conversation.
 *  - **simulated**: otherwise, generate procedural amplitude shaped to the
 *    current cockpit state (idle breath, listening syllables, thinking
 *    ticks, speaking phrases, etc.). Mirrors the reference design's
 *    audio.jsx hook exactly so the orb looks alive even with no agent.
 *
 * Returns { level: number 0..1, fft: Float32Array(32) }.
 */

export interface AudioLevel {
  level: number;
  fft: Float32Array;
}

type Source = 'session' | 'simulated' | 'off';

export function useAudioLevel(source: Source, state: CockpitState): AudioLevel {
  const [data, setData] = useState<AudioLevel>(() => ({
    level: 0,
    fft: new Float32Array(32),
  }));
  const levelRef = useRef(0);
  const liveVadRef = useRef(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef(performance.now());

  // Subscribe to Rust's voice:vad events. Drives `liveVadRef` continuously;
  // the simulator falls back when no VAD has fired in the last second.
  useEffect(() => {
    let un: (() => void) | undefined;
    let last = 0;
    listen<number>('voice:vad', (e) => {
      last = performance.now();
      const v = typeof e.payload === 'number' ? e.payload : 0;
      liveVadRef.current = Math.max(0, Math.min(1, v));
    }).then((fn) => {
      un = fn;
    });
    const ageId = window.setInterval(() => {
      if (performance.now() - last > 1500) liveVadRef.current = 0;
    }, 500);
    return () => {
      un?.();
      window.clearInterval(ageId);
    };
  }, []);

  useEffect(() => {
    const sim = makeSimulated(state);

    function tick() {
      const t = (performance.now() - startRef.current) / 1000;
      let level = 0;
      let fft: Float32Array;

      if (source === 'off') {
        level = 0;
        fft = new Float32Array(32);
      } else if (source === 'session' && liveVadRef.current > 0) {
        // Real VAD. Smooth + synthesise an FFT shape from the level.
        const target = liveVadRef.current;
        level = levelRef.current + (target - levelRef.current) * 0.25;
        fft = makeSimulatedFFT(state, level, t);
      } else {
        // Either explicit simulated source, or session with no VAD yet.
        level = sim(t, levelRef.current);
        fft = makeSimulatedFFT(state, level, t);
      }
      levelRef.current = level;
      setData({ level, fft });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [source, state]);

  return data;
}

// ───────────────────────── simulated sources ─────────────────────────

function makeSimulated(state: CockpitState): (t: number, prev: number) => number {
  return (t, prev) => {
    let target = 0;
    switch (state) {
      case 'idle': {
        target = 0.04 + 0.025 * (Math.sin(t * 0.7) * 0.5 + 0.5);
        break;
      }
      case 'wake': {
        const since = t % 1.2;
        target = Math.max(0, 0.85 * Math.exp(-since * 4));
        break;
      }
      case 'listening': {
        const s1 = Math.sin(t * 7.3) * 0.5 + 0.5;
        const s2 = Math.sin(t * 13.1 + 1.2) * 0.5 + 0.5;
        const env = s1 * 0.6 + s2 * 0.4;
        const word = Math.sin(t * 1.7) > -0.2 ? 1 : 0.15;
        target = 0.18 + env * word * 0.55;
        break;
      }
      case 'thinking': {
        const hum = 0.08 + 0.04 * Math.sin(t * 2.0);
        const tick = Math.sin(t * 11) > 0.92 ? 0.25 : 0;
        target = hum + tick;
        break;
      }
      case 'speaking': {
        const s1 = Math.sin(t * 4.7) * 0.5 + 0.5;
        const s2 = Math.sin(t * 9.2 + 0.8) * 0.5 + 0.5;
        const phrase = Math.sin(t * 0.9 - 0.4) * 0.5 + 0.5;
        target = 0.15 + (s1 * 0.5 + s2 * 0.5) * phrase * 0.7;
        break;
      }
      case 'content': {
        target = 0.06 + 0.03 * Math.sin(t * 1.3);
        break;
      }
      default:
        target = 0.05;
    }
    const smoothing = 0.18;
    return prev + (target - prev) * smoothing;
  };
}

function makeSimulatedFFT(state: CockpitState, level: number, t: number): Float32Array {
  const out = new Float32Array(32);
  for (let i = 0; i < 32; i++) {
    const norm = i / 32;
    let bin = level * (1.0 - norm * 0.55);
    bin *= 0.55 + 0.45 * (Math.sin(t * (2 + i * 0.35) + i * 0.7) * 0.5 + 0.5);
    if (state === 'thinking') {
      bin *= 0.3 + 0.7 * (Math.sin(t * 3 + i) > 0.4 ? 1 : 0.2);
    }
    if (state === 'wake') {
      bin = Math.min(1, bin * 1.6);
    }
    out[i] = Math.max(0, Math.min(1, bin));
  }
  return out;
}
