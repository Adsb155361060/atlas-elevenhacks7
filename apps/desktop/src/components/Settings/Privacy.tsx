import { useState } from 'react';
import { resetAllData } from '../../ipc/settings';
import { useOnboarding } from '../../state/onboarding';
import { useView } from '../../state/view';
import { useTranscripts } from '../../state/transcripts';

const CONFIRM_WORD = 'delete';

export function Privacy() {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOnboardingCompleted = useOnboarding((s) => s.setCompleted);
  const setOnboardingStep = useOnboarding((s) => s.setStep);
  const setView = useView((s) => s.setView);
  const clearTranscripts = useTranscripts((s) => s.clear);

  const ready = confirm.trim().toLowerCase() === CONFIRM_WORD;

  const wipe = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await resetAllData();
      clearTranscripts();
      setOnboardingStep('welcome');
      setOnboardingCompleted(false);
      setView('home'); // routes back to <Onboarding /> via App.tsx
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <section>
      <h1 className="text-2xl font-light tracking-tight">Privacy</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        Atlas keeps most of its state on this machine. The buttons here let you wipe it.
      </p>

      <div className="mt-6 space-y-4">
        <div className="rounded-md border border-slate-800 bg-slate-900/40 px-5 py-4">
          <h2 className="text-base text-slate-100 font-medium">What lives where</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-400">
            <li>
              <span className="text-slate-300">On this machine</span>: voice preferences,
              future conversation memory + audit log. Backed by{' '}
              <span className="font-mono text-[12px]">~/.config/com.atlas.desktop/</span>{' '}
              on Linux (equivalent paths on macOS / Windows).
            </li>
            <li>
              <span className="text-slate-300">In real time only</span>: mic audio to
              ElevenLabs for STT + TTS; text routed via your worker to Claude. Nothing is
              stored beyond the live session.
            </li>
            <li>
              <span className="text-slate-300">In your ElevenLabs account</span>: any
              voice you cloned. Delete those from{' '}
              <span className="font-mono text-[12px]">elevenlabs.io/app/voice-lab</span>{' '}
              — Atlas can't reach across your account.
            </li>
          </ul>
        </div>

        <div className="rounded-md border border-rose-900/40 bg-rose-950/20 px-5 py-4">
          <h2 className="text-base text-rose-200 font-medium">Reset everything local</h2>
          <p className="mt-1.5 text-sm text-rose-300/80">
            Wipes voice preferences, closes any active voice session, and drops you back
            into the onboarding flow.
            <br />
            Doesn't reach into ElevenLabs or your worker. Type <span className="font-mono text-rose-200">{CONFIRM_WORD}</span> to confirm.
          </p>
          <div className="mt-4 flex gap-3">
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={CONFIRM_WORD}
              disabled={busy}
              className="flex-1 px-3 py-2 bg-slate-950 border border-rose-900/40 rounded-md text-sm text-slate-100 focus:outline-none focus:border-rose-500/60"
            />
            <button
              type="button"
              onClick={wipe}
              disabled={!ready || busy}
              className="text-sm px-4 py-2 rounded-md bg-rose-600 text-slate-50 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? 'Wiping…' : 'Delete all local data'}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
