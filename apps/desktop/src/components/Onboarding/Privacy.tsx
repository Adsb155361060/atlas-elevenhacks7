import { useOnboarding } from '../../state/onboarding';
import { OnboardingShell } from './shell';

export function Privacy() {
  const next = useOnboarding((s) => s.next);
  const back = useOnboarding((s) => s.back);
  return (
    <OnboardingShell
      step={2}
      total={4}
      title="What stays here, what doesn't."
      subtitle="The short version: everything you can avoid sending off this machine, we don't send."
      primary={{ label: 'Got it', onClick: next }}
      secondary={{ label: 'Back', onClick: back }}
    >
      <ul className="space-y-4 text-sm text-slate-300">
        <li>
          <span className="text-slate-100 font-medium">On this machine.</span>
          <p className="mt-1 text-slate-400">
            Conversations, memory, audit log, wakeword model. SQLite + LanceDB
            live in your OS config dir. You can wipe everything in one click
            from Settings.
          </p>
        </li>
        <li>
          <span className="text-slate-100 font-medium">Off this machine, in real time only.</span>
          <p className="mt-1 text-slate-400">
            Mic audio streams to ElevenLabs for transcription and synthesis
            (Scribe v2 + Flash v2.5). Text gets routed through your worker to
            Claude for reasoning. None of it is stored beyond the active session.
          </p>
        </li>
        <li>
          <span className="text-slate-100 font-medium">Your voice clone.</span>
          <p className="mt-1 text-slate-400">
            If you cloned a voice just now, the model file lives at ElevenLabs
            under your account. Delete it any time from their dashboard or from
            Atlas Settings.
          </p>
        </li>
        <li>
          <span className="text-slate-100 font-medium">No telemetry by default.</span>
          <p className="mt-1 text-slate-400">
            Atlas doesn't phone home with usage data. You can opt in to anonymous
            crash reports later in Settings if you want to help.
          </p>
        </li>
      </ul>
    </OnboardingShell>
  );
}
