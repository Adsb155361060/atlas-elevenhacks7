import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtlasState, type AtlasUIState } from './state/store';
import { getState, subscribeToState } from './ipc/state';
import { subscribeToTranscripts } from './ipc/transcripts';
import { useTranscripts } from './state/transcripts';
import { StatusDot } from './components/StatusDot';
import { CaptionStrip } from './components/CaptionStrip';

const PROMPT_BY_STATE: Record<AtlasUIState, string> = {
  idle: "Hold Super+Space or say 'Hey Atlas' to begin",
  armed: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  paused: 'Paused — click the tray to resume',
};

export function App() {
  const state = useAtlasState((s) => s.state);
  const setState = useAtlasState((s) => s.setState);
  const ingestTranscript = useTranscripts((s) => s.ingest);
  const clearTranscripts = useTranscripts((s) => s.clear);

  // Bootstrap from current backend state, then subscribe to changes.
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

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-8">
      <StatusDot state={state} />

      <p
        className="mt-8 max-w-md text-center text-lg text-slate-300"
        aria-live="polite"
      >
        {PROMPT_BY_STATE[state]}
      </p>

      <footer className="mt-12 text-[10px] text-slate-600 uppercase tracking-[0.2em]">
        Atlas · phase 0.e — voice loop
      </footer>

      <CaptionStrip />
    </main>
  );
}
