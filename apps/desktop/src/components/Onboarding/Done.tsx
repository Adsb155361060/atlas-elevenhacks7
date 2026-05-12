import { useOnboarding } from '../../state/onboarding';
import { completeOnboarding } from '../../ipc/voice-prefs';
import { OnboardingShell } from './shell';

export function Done() {
  const back = useOnboarding((s) => s.back);
  const setCompleted = useOnboarding((s) => s.setCompleted);
  const pickedVoice = useOnboarding((s) => s.pickedVoice);

  const finish = async () => {
    await completeOnboarding();
    setCompleted(true);
  };

  return (
    <OnboardingShell
      step={3}
      total={4}
      title="You're set."
      subtitle={
        pickedVoice
          ? `Atlas will speak in ${pickedVoice.name}. You can change that anytime from Settings.`
          : 'Atlas will use the dev default voice. You can pick a real one anytime from Settings.'
      }
      primary={{ label: 'Open Atlas', onClick: finish }}
      secondary={{ label: 'Back', onClick: back }}
    >
      <div className="rounded-md border border-slate-800 bg-slate-900/40 px-5 py-4">
        <h2 className="text-sm font-medium text-slate-100">Try it</h2>
        <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
          Say <span className="text-emerald-400 font-mono">"Hey Atlas"</span> any time, or hit the
          global hotkey. The tray indicator pulses when Atlas is listening.
        </p>
      </div>
    </OnboardingShell>
  );
}
