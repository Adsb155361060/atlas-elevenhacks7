import { useOnboarding } from '../../state/onboarding';
import { OnboardingShell } from './shell';

export function Welcome() {
  const next = useOnboarding((s) => s.next);
  return (
    <OnboardingShell
      step={0}
      total={4}
      title="Welcome to Atlas."
      subtitle="A voice-first assistant that lives on your desktop. Three quick steps and we're going."
      primary={{ label: 'Get started', onClick: next }}
    >
      <ul className="space-y-3 text-slate-300 text-sm">
        <li className="flex gap-3">
          <span className="text-emerald-400 select-none">·</span>
          Pick the voice Atlas speaks in — a stock voice, or clone one in a minute.
        </li>
        <li className="flex gap-3">
          <span className="text-emerald-400 select-none">·</span>
          A quick look at what stays on this machine and what doesn't.
        </li>
        <li className="flex gap-3">
          <span className="text-emerald-400 select-none">·</span>
          That's it. You can come back and change anything later.
        </li>
      </ul>
    </OnboardingShell>
  );
}
