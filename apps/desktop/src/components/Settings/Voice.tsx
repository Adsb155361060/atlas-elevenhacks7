import { useEffect, useState } from 'react';
import { getPrefs, type VoicePreferences } from '../../ipc/voice-prefs';
import { useOnboarding } from '../../state/onboarding';
import {
  SettingsHeading,
  SettingsSubtitle,
  SettingsCard,
  SettingsLabel,
  GhostButton,
} from './primitives';

const SOURCE_LABEL: Record<string, string> = {
  stock: 'Stock voice',
  cloned_record: 'Cloned (recorded in app)',
  cloned_upload: 'Cloned (uploaded sample)',
};

interface Props {
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
    setOnboardingStep('voice');
    setOnboardingCompleted(false);
    onPickAgain();
  };

  return (
    <section>
      <SettingsHeading>Voice</SettingsHeading>
      <SettingsSubtitle>
        Atlas speaks to you in whatever voice you picked. You can change it any time —
        the next session will use the new voice.
      </SettingsSubtitle>

      <SettingsCard>
        <SettingsLabel>Current voice</SettingsLabel>
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <div
              className="serif"
              style={{
                fontSize: 24,
                fontStyle: 'italic',
                color: 'var(--cream)',
                fontVariationSettings: '"opsz" 36, "SOFT" 30',
              }}
            >
              {prefs?.voice_name ?? 'Stock default'}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--cream-mute)',
                marginTop: 6,
              }}
            >
              {prefs?.voice_source
                ? SOURCE_LABEL[prefs.voice_source] ?? prefs.voice_source
                : 'Not configured'}
            </div>
            {prefs?.voice_id ? (
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--cream-faint)',
                  marginTop: 4,
                }}
              >
                {prefs.voice_id}
              </div>
            ) : null}
          </div>
          <GhostButton onClick={repick}>Pick a new voice</GhostButton>
        </div>
      </SettingsCard>
    </section>
  );
}
