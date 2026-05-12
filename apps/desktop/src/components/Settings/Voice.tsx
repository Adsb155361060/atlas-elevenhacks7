import { useEffect, useState } from 'react';
import { getPrefs, type VoicePreferences } from '../../ipc/voice-prefs';
import { useOnboarding } from '../../state/onboarding';

const SOURCE_LABEL: Record<string, string> = {
  stock: 'Stock voice',
  cloned_record: 'Cloned (recorded in app)',
  cloned_upload: 'Cloned (uploaded sample)',
};

interface Props {
  /** Called when the user wants to re-run the voice-picker wizard. */
  onPickAgain: () => void;
}

export function Voice({ onPickAgain }: Props) {
  const [prefs, setPrefs] = useState<VoicePreferences | null>(null);
  const setOnboardingCompleted = useOnboarding((s) => s.setCompleted);
  const setOnboardingStep = useOnboarding((s) => s.setStep);

  useEffect(() => {
    getPrefs().then(setPrefs).catch(() => undefined);
  }, []);

  const repick = () => {
    // Drop the user back into the voice-picker step of onboarding.
    setOnboardingStep('voice');
    setOnboardingCompleted(false);
    onPickAgain();
  };

  return (
    <section>
      <h1 className="text-2xl font-light tracking-tight">Voice</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        Atlas speaks to you in whatever voice you picked. You can change it any time —
        the next session will use the new voice.
      </p>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/40 px-5 py-4">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">
          Current voice
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-4">
          <div>
            <div className="text-lg text-slate-100 font-medium">
              {prefs?.voice_name ?? 'Stock default'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {prefs?.voice_source ? SOURCE_LABEL[prefs.voice_source] ?? prefs.voice_source : 'Not configured'}
            </div>
            {prefs?.voice_id ? (
              <div className="text-[10px] text-slate-600 mt-1 font-mono">
                {prefs.voice_id}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={repick}
            className="text-sm px-4 py-2 rounded-md border border-slate-700 hover:border-emerald-500/60 text-slate-200 hover:text-emerald-300 transition-colors"
          >
            Pick a new voice
          </button>
        </div>
      </div>
    </section>
  );
}
