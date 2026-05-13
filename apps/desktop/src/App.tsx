/**
 * Atlas — main app shell. Brass-and-ink cockpit layout.
 *
 * Layers (back to front):
 *   1. cockpit-stage (ink background + film grain)
 *   2. HUD (coordinate grid + 4 telemetry corners)
 *   3. OrbStage (centered or pinned upper-left when an artifact is active)
 *   4. ContentPane (right side when artifact active)
 *   5. CaptionRail (bottom-left)
 *   6. Floating overlays (TimerStack, ToolBadge, ErrorToast, FirstRunTutorial)
 *
 * Onboarding + Settings keep their own backgrounds for now — they don't
 * render the cockpit, so reskinning them happens in a follow-up commit.
 */

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAtlasState } from './state/store';
import { getState, subscribeToState } from './ipc/state';
import { subscribeToTranscripts } from './ipc/transcripts';
import { useTranscripts } from './state/transcripts';
import { useOnboarding } from './state/onboarding';
import { useView } from './state/view';
import { useArtifact } from './state/artifact';
import { useFirstRun } from './state/firstRun';
import { useToolStatus } from './state/toolStatus';
import { useAudioLevel } from './state/audio';
import { toCockpitState, type CockpitState } from './state/cockpit';
import { getPrefs } from './ipc/voice-prefs';
import { subscribeToArtifacts } from './ipc/artifact';
import { subscribeToCameraCaptures } from './ipc/camera';
import { subscribeToToolStatus } from './ipc/toolStatus';
import { requestMicrophonePermission } from './ipc/mic';
import { HUD } from './components/HUD';
import { OrbStage } from './components/OrbStage';
import { CaptionRail } from './components/CaptionRail';
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';
import { ArtifactSurface } from './components/Artifact';
import { TimerStack } from './components/TimerStack';
import { ToolBadge } from './components/ToolBadge';
import { ErrorToast } from './components/ErrorToast';
import { FirstRunTutorial } from './components/FirstRunTutorial';

// Coordinate-grid opacity per cockpit state — denser mid-conversation,
// quieter at rest. Mirrors the reference design's GRID_OPACITY.
const GRID_OPACITY: Record<CockpitState, number> = {
  idle: 0.06,
  wake: 0.1,
  listening: 0.1,
  thinking: 0.08,
  speaking: 0.08,
  content: 0.14,
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
  const startToolCall = useToolStatus((s) => s.startCall);
  const endToolCall = useToolStatus((s) => s.endCall);
  const pushToolError = useToolStatus((s) => s.pushError);
  const setFirstRunDismissed = useFirstRun((s) => s.setDismissed);

  // The Rust agent emits voice:session_started with the ElevenLabs
  // conversation_id; we display its first 8 chars in the TLCorner so the
  // hex feels real mid-call, not a per-window random number.
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Cockpit state = AtlasUIState mapped to the design's 6-state machine.
  // 'content' fires when an artifact is rendered alongside speaking/idle.
  const cockpit = toCockpitState(state, currentArtifact !== null);

  // Audio source: real VAD when a session is live; simulated otherwise so
  // the orb never feels frozen.
  const audioSource = state === 'idle' || state === 'paused' ? 'simulated' : 'session';
  const audio = useAudioLevel(audioSource, cockpit);

  // First-run flag — read from localStorage.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('atlas:first_run_dismissed');
      setFirstRunDismissed(v === 'true');
    } catch {
      setFirstRunDismissed(false);
    }
  }, [setFirstRunDismissed]);

  // Onboarding flag — read from Rust preferences.
  useEffect(() => {
    getPrefs()
      .then((p) => setOnboardingCompleted(p.onboarding_completed))
      .catch(() => setOnboardingCompleted(false));
  }, [setOnboardingCompleted]);

  // Prompt the OS for microphone access once onboarding is complete. On
  // Windows + WebView2 this surfaces the system mic dialog; on macOS it
  // triggers the TCC prompt. We release the stream immediately — cpal in
  // the Rust voice-loop reopens it per session. If denied, the toast in
  // ErrorToast offers a deep-link button to the OS mic settings.
  useEffect(() => {
    if (onboardingCompleted !== true) return;
    let cancelled = false;
    void requestMicrophonePermission().then((res) => {
      if (cancelled) return;
      if (res.ok) return;
      const message = res.denied
        ? 'Microphone access was denied. Open settings, allow Atlas to use the mic, then relaunch.'
        : res.reason;
      pushToolError('microphone', message);
    });
    return () => {
      cancelled = true;
    };
  }, [onboardingCompleted, pushToolError]);

  // Bootstrap + subscribe to all events.
  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenTranscripts: (() => void) | undefined;
    let unlistenSessionEnd: (() => void) | undefined;
    let unlistenSessionStart: (() => void) | undefined;
    let unlistenSettingsOpen: (() => void) | undefined;
    let unlistenArtifacts: (() => void) | undefined;
    let unlistenCamera: (() => void) | undefined;
    let unlistenToolStatus: (() => void) | undefined;
    let unlistenCaptureError: (() => void) | undefined;

    void getState().then(setState).catch(() => undefined);
    subscribeToState(setState).then((fn) => {
      unlistenState = fn;
    });
    subscribeToTranscripts(ingestTranscript).then((fn) => {
      unlistenTranscripts = fn;
    });
    listen<string>('voice:session_started', (e) => setConversationId(e.payload)).then((fn) => {
      unlistenSessionStart = fn;
    });
    listen('voice:session_ended', () => {
      clearTranscripts();
      clearArtifacts();
      setConversationId(null);
    }).then((fn) => {
      unlistenSessionEnd = fn;
    });
    listen('settings:open', () => setView('settings')).then((fn) => {
      unlistenSettingsOpen = fn;
    });
    subscribeToArtifacts(ingestArtifact).then((fn) => {
      unlistenArtifacts = fn;
    });
    subscribeToCameraCaptures().then((fn) => {
      unlistenCamera = fn;
    });
    subscribeToToolStatus(startToolCall, endToolCall).then((fn) => {
      unlistenToolStatus = fn;
    });
    listen<string>('voice:capture:error', (e) => {
      pushToolError('microphone', e.payload);
    }).then((fn) => {
      unlistenCaptureError = fn;
    });

    return () => {
      unlistenState?.();
      unlistenTranscripts?.();
      unlistenSessionStart?.();
      unlistenSessionEnd?.();
      unlistenSettingsOpen?.();
      unlistenArtifacts?.();
      unlistenCamera?.();
      unlistenToolStatus?.();
      unlistenCaptureError?.();
    };
  }, [
    setState,
    ingestTranscript,
    clearTranscripts,
    setView,
    ingestArtifact,
    clearArtifacts,
    startToolCall,
    endToolCall,
    pushToolError,
  ]);

  // Click-to-wake — anywhere on the cockpit (except buttons / data-no-wake
  // surfaces) fires a push-to-talk turn. Keeps the design's "tap anywhere"
  // affordance while leaving the settings gear and content pane interactive.
  useEffect(() => {
    if (!onboardingCompleted) return undefined;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('button')) return;
      if (target.closest('a')) return;
      if (target.closest('input,textarea,select')) return;
      if (target.closest('[data-no-wake]')) return;
      if (state === 'idle' || state === 'paused') {
        invoke<void>('fire_wake_test').catch(() => undefined);
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [state, onboardingCompleted]);

  // Pre-onboarding / settings: defer to their own shells (not the cockpit).
  if (onboardingCompleted === null) {
    return <div className="min-h-screen" style={{ background: 'var(--ink)' }} />;
  }
  if (!onboardingCompleted) {
    return <Onboarding />;
  }
  if (view === 'settings') {
    return <Settings />;
  }

  return (
    <main
      className="cockpit-stage"
      style={{ width: '100vw', height: '100vh' }}
      aria-label="Atlas cockpit"
    >
      <HUD
        state={cockpit}
        audio={audio}
        source={audioSource}
        gridOpacity={GRID_OPACITY[cockpit]}
        conversationId={conversationId}
      />

      <OrbStage state={cockpit} audio={audio} />

      {cockpit === 'content' && currentArtifact ? (
        <div
          className="content-pane"
          data-no-wake
          style={{
            position: 'absolute',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 'calc(55% - 96px)',
            maxWidth: 1020,
            paddingRight: 96,
            pointerEvents: 'auto',
            zIndex: 5,
          }}
        >
          <ArtifactSurface />
        </div>
      ) : null}

      <CaptionRail state={cockpit} wakeWord="Hey Atlas" artifact={currentArtifact} />

      <button
        type="button"
        aria-label="Open settings"
        title="Settings"
        onClick={() => setView('settings')}
        data-no-wake
        style={{
          position: 'absolute',
          top: 36,
          right: 240,
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: '1px solid var(--hair-strong)',
          borderRadius: 2,
          color: 'var(--cream-mute)',
          cursor: 'pointer',
          zIndex: 20,
        }}
      >
        <SettingsGearIcon />
      </button>

      <TimerStack />
      <ToolBadge />
      <ErrorToast />
      <FirstRunTutorial />
    </main>
  );
}

function SettingsGearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
