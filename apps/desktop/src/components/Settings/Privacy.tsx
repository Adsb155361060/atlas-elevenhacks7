import { useState } from 'react';
import { resetAllData } from '../../ipc/settings';
import { useOnboarding } from '../../state/onboarding';
import { useView } from '../../state/view';
import { useTranscripts } from '../../state/transcripts';
import {
  SettingsHeading,
  SettingsSubtitle,
  SettingsCard,
  SettingsLabel,
  DangerButton,
} from './primitives';

const CONFIRM_WORD = 'delete';

const STORAGE_ITEMS: Array<{ scope: string; body: React.ReactNode }> = [
  {
    scope: 'On this machine',
    body: (
      <>
        Voice preferences, conversation memory, and the audit log. Backed by{' '}
        <span className="mono" style={{ color: 'var(--brass)' }}>
          ~/.config/com.atlas.desktop/
        </span>{' '}
        on Linux (equivalent paths on macOS / Windows).
      </>
    ),
  },
  {
    scope: 'In real time only',
    body: (
      <>
        Mic audio to ElevenLabs for STT + TTS; text routed via your worker to Claude.
        Nothing is stored beyond the live session.
      </>
    ),
  },
  {
    scope: 'In your ElevenLabs account',
    body: (
      <>
        Any voice you cloned. Delete those from{' '}
        <span className="mono" style={{ color: 'var(--brass)' }}>
          elevenlabs.io/app/voice-lab
        </span>{' '}
        — Atlas can't reach across your account.
      </>
    ),
  },
];

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
      setView('home');
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <section>
      <SettingsHeading>Privacy</SettingsHeading>
      <SettingsSubtitle>
        Atlas keeps most of its state on this machine. The buttons here let you wipe it.
      </SettingsSubtitle>

      <SettingsCard>
        <SettingsLabel>What lives where</SettingsLabel>
        <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none' }}>
          {STORAGE_ITEMS.map((item, i) => (
            <li
              key={item.scope}
              style={{
                paddingTop: i === 0 ? 0 : 14,
                paddingBottom: i === STORAGE_ITEMS.length - 1 ? 0 : 14,
                borderBottom:
                  i === STORAGE_ITEMS.length - 1 ? 'none' : '1px solid var(--hair)',
              }}
            >
              <div
                className="serif"
                style={{
                  fontSize: 15,
                  fontStyle: 'italic',
                  color: 'var(--cream)',
                  fontVariationSettings: '"opsz" 36, "SOFT" 30',
                }}
              >
                {item.scope}
              </div>
              <div
                className="serif-body"
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--cream-mute)',
                }}
              >
                {item.body}
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard tone="danger">
        <SettingsLabel tone="brass">Reset everything local</SettingsLabel>
        <p
          className="serif-body"
          style={{
            marginTop: 10,
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--cream-mute)',
          }}
        >
          Wipes voice preferences, closes any active voice session, and drops you back into
          the onboarding flow. Doesn't reach into ElevenLabs or your worker. Type{' '}
          <span className="mono" style={{ color: 'var(--signal-red)' }}>
            {CONFIRM_WORD}
          </span>{' '}
          to confirm.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={CONFIRM_WORD}
            disabled={busy}
            className="mono"
            style={{
              flex: 1,
              padding: '10px 14px',
              background: 'rgba(20, 17, 14, 0.85)',
              border: '1px solid rgba(184, 88, 65, 0.4)',
              color: 'var(--cream)',
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--signal-red)')}
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = 'rgba(184, 88, 65, 0.4)')
            }
          />
          <DangerButton onClick={wipe} disabled={!ready || busy}>
            {busy ? 'Wiping…' : 'Delete all'}
          </DangerButton>
        </div>
        {error ? (
          <p
            className="mono"
            style={{
              marginTop: 12,
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--signal-red)',
            }}
          >
            {error}
          </p>
        ) : null}
      </SettingsCard>
    </section>
  );
}
