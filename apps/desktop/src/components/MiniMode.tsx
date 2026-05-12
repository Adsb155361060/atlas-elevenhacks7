import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtlasState, type AtlasUIState } from '../state/store';
import { useTranscripts } from '../state/transcripts';
import { getState, subscribeToState } from '../ipc/state';
import { subscribeToTranscripts } from '../ipc/transcripts';
import { StatusDot } from './StatusDot';

const COPY_BY_STATE: Record<AtlasUIState, string> = {
  idle: 'Hey Atlas',
  armed: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  paused: 'Paused',
};

/**
 * Compact always-on-top overlay. Renders the status dot + a single-line
 * fragment: either the conversational state copy (when idle) or the most
 * recent transcript line. Designed for the 320×96 mini window declared in
 * tauri.conf.json.
 */
export function MiniMode() {
  const state = useAtlasState((s) => s.state);
  const setState = useAtlasState((s) => s.setState);
  const ingestTranscript = useTranscripts((s) => s.ingest);
  const clearTranscripts = useTranscripts((s) => s.clear);
  const entries = useTranscripts((s) => s.entries);

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
      className="h-screen w-screen flex items-center gap-3 px-4 py-3 bg-slate-900/85 backdrop-blur-md border border-slate-700/60 rounded-2xl text-slate-100 select-none cursor-grab"
    >
      <div className="shrink-0 scale-50 origin-left">
        <StatusDot state={state} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="text-sm leading-tight line-clamp-2 break-words"
          aria-live="polite"
        >
          {line}
        </p>
        <p className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-500">
          {latest?.role === 'user' ? 'you' : latest ? 'atlas' : 'atlas'}
        </p>
      </div>
    </div>
  );
}
