import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtlasState, type AtlasUIState } from './state/store';
import { getState, subscribeToState } from './ipc/state';
import { subscribeToTranscripts } from './ipc/transcripts';
import { useTranscripts } from './state/transcripts';
import { useOnboarding } from './state/onboarding';
import { useView } from './state/view';
import { useArtifact } from './state/artifact';
import { getPrefs } from './ipc/voice-prefs';
import { subscribeToArtifacts } from './ipc/artifact';
import { subscribeToCameraCaptures } from './ipc/camera';
import { StatusDot } from './components/StatusDot';
import { CaptionStrip } from './components/CaptionStrip';
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';
import { ArtifactSurface } from './components/Artifact';
import { TimerStack } from './components/TimerStack';

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
  const ingestArtifact = useArtifact((s) => s.ingest);
  const clearArtifacts = useArtifact((s) => s.clear);
  const currentArtifact = useArtifact((s) => s.current);

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
    let unlistenArtifacts: (() => void) | undefined;

    void getState().then(setState).catch(() => undefined);

    subscribeToState(setState).then((fn) => {
      unlistenState = fn;
    });

    subscribeToTranscripts(ingestTranscript).then((fn) => {
      unlistenTranscripts = fn;
    });

    listen('voice:session_ended', () => {
      clearTranscripts();
      clearArtifacts();
    }).then((fn) => {
      unlistenSessionEnd = fn;
    });

    listen('settings:open', () => setView('settings')).then((fn) => {
      unlistenSettingsOpen = fn;
    });

    subscribeToArtifacts(ingestArtifact).then((fn) => {
      unlistenArtifacts = fn;
    });

    let unlistenCamera: (() => void) | undefined;
    subscribeToCameraCaptures().then((fn) => {
      unlistenCamera = fn;
    });

    return () => {
      unlistenState?.();
      unlistenTranscripts?.();
      unlistenSessionEnd?.();
      unlistenSettingsOpen?.();
      unlistenArtifacts?.();
      unlistenCamera?.();
    };
  }, [setState, ingestTranscript, clearTranscripts, setView, ingestArtifact, clearArtifacts]);

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
    <main className="relative min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Header — status dot moves up here once an artifact is active so the artifact gets the central spotlight. */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-900">
        <div className="flex items-center gap-3">
          <div className="scale-75 origin-left">
            <StatusDot state={state} />
          </div>
          <p className="text-sm text-slate-400" aria-live="polite">
            {PROMPT_BY_STATE[state]}
          </p>
        </div>
        <button
          type="button"
          aria-label="Open settings"
          title="Settings"
          onClick={() => setView('settings')}
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors"
        >
          <SettingsGearIcon />
        </button>
      </header>

      {/* Body — artifact takes the centre when one exists; idle copy otherwise. */}
      <div className="flex-1 overflow-y-auto px-6 py-8 pb-32">
        {currentArtifact ? (
          <ArtifactSurface />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <p className="text-2xl font-light text-slate-300 text-center max-w-md">
              Ask me anything.
            </p>
            <p className="mt-3 text-sm text-slate-500">
              Hold <kbd className="font-mono text-slate-400">⌘&nbsp;+&nbsp;Shift&nbsp;+&nbsp;A</kbd> to talk.
            </p>
          </div>
        )}
      </div>

      <CaptionStrip />
      <TimerStack />
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
