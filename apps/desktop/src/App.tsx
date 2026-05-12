import { useEffect } from 'react';
import { useAtlasState, type AtlasUIState } from './state/store';
import { getState, subscribeToState } from './ipc/state';
import { StatusDot } from './components/StatusDot';

const PROMPT_BY_STATE: Record<AtlasUIState, string> = {
  idle: "Hold Super+Space or say 'Hey Atlas' to begin",
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  paused: 'Paused — click the tray to resume',
};

export function App() {
  const state = useAtlasState((s) => s.state);
  const setState = useAtlasState((s) => s.setState);

  // Bootstrap from current backend state, then subscribe to changes.
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    void getState().then(setState).catch(() => undefined);

    subscribeToState(setState).then((fn) => {
      unlistenFn = fn;
    });

    return () => {
      unlistenFn?.();
    };
  }, [setState]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-8">
      <StatusDot state={state} />

      <p
        className="mt-8 max-w-md text-center text-lg text-slate-300"
        aria-live="polite"
      >
        {PROMPT_BY_STATE[state]}
      </p>

      <footer className="mt-12 text-[10px] text-slate-600 uppercase tracking-[0.2em]">
        Atlas · pre-phase-0.e scaffold
      </footer>
    </main>
  );
}
