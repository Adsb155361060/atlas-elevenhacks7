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
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          'Pick the voice Atlas speaks in — a stock voice, or clone one in a minute.',
          "A quick look at what stays on this machine and what doesn't.",
          "That's it. You can come back and change anything later.",
        ].map((line, i) => (
          <li
            key={i}
            className="serif-body"
            style={{
              display: 'flex',
              gap: 14,
              alignItems: 'baseline',
              fontSize: 15,
              color: 'var(--cream-dim)',
              lineHeight: 1.5,
            }}
          >
            <span aria-hidden style={{ color: 'var(--brass)', fontFamily: 'var(--font-mono)' }}>
              0{i + 1}
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </OnboardingShell>
  );
}
