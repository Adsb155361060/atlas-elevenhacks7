import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtlasState, type AtlasUIState } from '../state/store';
import { useTranscripts } from '../state/transcripts';
import { useArtifact } from '../state/artifact';
import { useAudioLevel } from '../state/audio';
import { toCockpitState, type CockpitState } from '../state/cockpit';
import { getState, subscribeToState } from '../ipc/state';
import { subscribeToTranscripts } from '../ipc/transcripts';
import { Orb } from './Orb';

const COPY_BY_STATE: Record<AtlasUIState, string> = {
  idle: 'Hey Atlas',
  armed: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  paused: 'Paused',
};

/**
 * Mini overlay window — a compact always-on-top pill. Same data, smaller
 * surface. Uses a small Orb instead of the deprecated StatusDot.
 */
export function MiniMode() {
  const state = useAtlasState((s) => s.state);
  const setState = useAtlasState((s) => s.setState);
  const ingestTranscript = useTranscripts((s) => s.ingest);
  const clearTranscripts = useTranscripts((s) => s.clear);
  const entries = useTranscripts((s) => s.entries);
  const currentArtifact = useArtifact((s) => s.current);
  const cockpit: CockpitState = toCockpitState(state, currentArtifact !== null);
  const audio = useAudioLevel('session', cockpit);

  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenTranscripts: (() => void) | undefined;
    let unlistenSessionEnd: (() => void) | undefined;

    void getState().then(setState).catch(() => undefined);
    subscribeToState(setState).then((fn) => {
      unlistenState = fn;
    });
    subscribeToTranscripts(ingestTranscript).then((fn) => {
      unlistenTranscripts = fn;
    });
    listen('voice:session_ended', () => clearTranscripts()).then((fn) => {
      unlistenSessionEnd = fn;
    });

    return () => {
      unlistenState?.();
      unlistenTranscripts?.();
      unlistenSessionEnd?.();
    };
  }, [setState, ingestTranscript, clearTranscripts]);

  const latest = entries[entries.length - 1];
  const line =
    latest && (state === 'listening' || state === 'speaking' || state === 'thinking')
      ? latest.text
      : COPY_BY_STATE[state];

  return (
    <div
      data-tauri-drag-region
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'rgba(20, 17, 14, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--hair-strong)',
        borderRadius: 14,
        color: 'var(--cream)',
        userSelect: 'none',
        cursor: 'grab',
      }}
    >
      <div style={{ width: 56, height: 56, flexShrink: 0 }}>
        <Orb state={cockpit} audio={audio} reduced />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          className="serif-body"
          style={{
            fontSize: 14,
            lineHeight: 1.3,
            margin: 0,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
          aria-live="polite"
        >
          {line}
        </p>
        <p
          className="mono"
          style={{
            margin: '4px 0 0',
            fontSize: 9,
            letterSpacing: '0.22em',
            color: 'var(--cream-mute)',
            textTransform: 'uppercase',
          }}
        >
          {latest?.role === 'user' ? 'you' : latest ? 'atlas' : 'atlas'}
        </p>
      </div>
    </div>
  );
}
