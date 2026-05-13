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
      <div
        style={{
          border: '1px solid var(--hair-strong)',
          background: 'rgba(20, 17, 14, 0.55)',
          padding: '20px 22px',
        }}
      >
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--brass)',
          }}
        >
          Try it
        </p>
        <p
          className="serif-body"
          style={{
            marginTop: 10,
            fontSize: 15,
            lineHeight: 1.55,
            color: 'var(--cream-dim)',
          }}
        >
          Say{' '}
          <span className="mono" style={{ color: 'var(--brass)' }}>
            "Hey Atlas"
          </span>{' '}
          any time, or hit{' '}
          <span className="mono" style={{ color: 'var(--brass)' }}>
            ⌘ + ⇧ + A
          </span>
          . The orb breathes brass when it's listening.
        </p>
      </div>
    </OnboardingShell>
  );
}
