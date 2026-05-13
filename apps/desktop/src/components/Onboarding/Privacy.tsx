import { useOnboarding } from '../../state/onboarding';
import { OnboardingShell } from './shell';

const ITEMS: Array<{ label: string; body: string }> = [
  {
    label: 'On this machine',
    body:
      'Conversations, memory, audit log, wakeword model. SQLite + LanceDB live in your OS config dir. You can wipe everything in one click from Settings.',
  },
  {
    label: 'Off this machine, in real time only',
    body:
      'Mic audio streams to ElevenLabs for transcription and synthesis (Scribe v2 + Flash v2.5). Text gets routed through your worker to Claude for reasoning. None of it is stored beyond the active session.',
  },
  {
    label: 'Your voice clone',
    body:
      'If you cloned a voice just now, the model file lives at ElevenLabs under your account. Delete it any time from their dashboard or from Atlas Settings.',
  },
  {
    label: 'No telemetry by default',
    body:
      "Atlas doesn't phone home with usage data. You can opt in to anonymous crash reports later in Settings if you want to help.",
  },
];

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
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {ITEMS.map((item, i) => (
          <li key={i}>
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
              {item.label}
            </p>
            <p
              className="serif-body"
              style={{
                marginTop: 6,
                fontSize: 14,
                lineHeight: 1.6,
                color: 'var(--cream-dim)',
              }}
            >
              {item.body}
            </p>
          </li>
        ))}
      </ul>
    </OnboardingShell>
  );
}
