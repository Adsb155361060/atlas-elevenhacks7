import { useEffect, useState } from 'react';
import { useAtlasState, type AtlasUIState } from '../../state/store';
import { setState as setBackendState } from '../../ipc/state';
import { SettingsHeading, SettingsSubtitle, SettingsCard, SettingsLabel } from './primitives';

const HOTKEY_BY_OS = (() => {
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(ua)) return '⌘ + ⇧ + A';
  return 'Ctrl + Shift + A';
})();

export function Wake() {
  const currentState = useAtlasState((s) => s.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wakeEnabled = currentState !== 'paused';

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const target: AtlasUIState = next ? 'idle' : 'paused';
      await setBackendState(target);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setError(null);
  }, [currentState]);

  return (
    <section>
      <SettingsHeading>Wake word</SettingsHeading>
      <SettingsSubtitle>
        Atlas listens for <span className="mono" style={{ color: 'var(--brass)' }}>"Hey Atlas"</span>{' '}
        when wake is on. Pausing keeps the mic ignored unless you push-to-talk.
      </SettingsSubtitle>

      <SettingsCard>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              className="serif"
              style={{
                fontSize: 18,
                fontStyle: 'italic',
                color: 'var(--cream)',
                fontVariationSettings: '"opsz" 36, "SOFT" 30',
              }}
            >
              Enable wake-word detection
            </div>
            <div
              className="serif-body"
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--cream-mute)',
                marginTop: 6,
              }}
            >
              When off, the on-device detector pauses. The push-to-talk hotkey still works.
            </div>
          </div>
          <ToggleSwitch checked={wakeEnabled} disabled={busy} onChange={toggle} />
        </label>
      </SettingsCard>

      <SettingsCard style={{ marginTop: 12 }}>
        <SettingsLabel>Push-to-talk hotkey</SettingsLabel>
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 16,
              color: 'var(--brass)',
              letterSpacing: '0.05em',
            }}
          >
            {HOTKEY_BY_OS}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--cream-faint)',
            }}
          >
            Rebinding · later phase
          </div>
        </div>
      </SettingsCard>

      {error ? (
        <p
          className="mono"
          style={{
            marginTop: 16,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--signal-red)',
          }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        border: `1px solid ${checked ? 'var(--brass)' : 'var(--hair-strong)'}`,
        background: checked ? 'rgba(201, 160, 79, 0.25)' : 'rgba(20, 17, 14, 0.65)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 220ms ease',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: checked ? 'var(--brass)' : 'var(--cream-mute)',
          transition: 'left 220ms ease, background 220ms ease',
        }}
      />
    </button>
  );
}
