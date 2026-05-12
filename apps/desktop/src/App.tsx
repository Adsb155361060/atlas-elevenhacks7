import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtlasState, type AtlasUIState } from './state/store';
import { getState, subscribeToState } from './ipc/state';
import { subscribeToTranscripts } from './ipc/transcripts';
import { useTranscripts } from './state/transcripts';
import { useOnboarding } from './state/onboarding';
import { useView } from './state/view';
import { getPrefs } from './ipc/voice-prefs';
import { StatusDot } from './components/StatusDot';
import { CaptionStrip } from './components/CaptionStrip';
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';

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
  const onboardingCompleted = useOnboarding((s) => s.completed);
  const setOnboardingCompleted = useOnboarding((s) => s.setCompleted);
  const view = useView((s) => s.view);
  const setView = useView((s) => s.setView);

  // Bootstrap onboarding state from Rust prefs. Runs once on mount.
  useEffect(() => {
    getPrefs()
      .then((p) => setOnboardingCompleted(p.onboarding_completed))
      .catch(() => setOnboardingCompleted(false));
  }, [setOnboardingCompleted]);

  // Bootstrap from current backend state, then subscribe to changes.
  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenTranscripts: (() => void) | undefined;
    let unlistenSessionEnd: (() => void) | undefined;
    let unlistenSettingsOpen: (() => void) | undefined;

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

    listen('settings:open', () => setView('settings')).then((fn) => {
      unlistenSettingsOpen = fn;
    });

    return () => {
      unlistenState?.();
      unlistenTranscripts?.();
      unlistenSessionEnd?.();
      unlistenSettingsOpen?.();
    };
  }, [setState, ingestTranscript, clearTranscripts, setView]);

  // Loading: prefs not yet known — render a blank screen for one tick.
  if (onboardingCompleted === null) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (!onboardingCompleted) {
    return <Onboarding />;
  }

  if (view === 'settings') {
    return <Settings />;
  }

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-8">
      <button
        type="button"
        aria-label="Open settings"
        title="Settings"
        onClick={() => setView('settings')}
        className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors"
      >
        <SettingsGearIcon />
      </button>

      <StatusDot state={state} />

      <p
        className="mt-8 max-w-md text-center text-lg text-slate-300"
        aria-live="polite"
      >
        {PROMPT_BY_STATE[state]}
      </p>

      <footer className="mt-12 text-[10px] text-slate-600 uppercase tracking-[0.2em]">
        Atlas · phase 0.h — settings
      </footer>

      <CaptionStrip />
    </main>
  );
}

function SettingsGearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
