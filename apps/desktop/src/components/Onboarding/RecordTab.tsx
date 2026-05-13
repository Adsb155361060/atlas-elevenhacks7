import { useEffect, useRef, useState } from 'react';
import { recordAndClone } from '../../ipc/voice-prefs';
import { useOnboarding } from '../../state/onboarding';

interface RecordTabProps {
  onPicked: () => void;
}

const DEFAULT_SECONDS = 30;

export function RecordTab({ onPicked }: RecordTabProps) {
  const [voiceName, setVoiceName] = useState('My Atlas voice');
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const timerRef = useRef<number | null>(null);
  const setPickedVoice = useOnboarding((s) => s.setPickedVoice);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
    }
  }, []);

  const start = async () => {
    setError(null);
    setSuccess(false);
    setRecording(true);
    setRemaining(seconds);
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      setRemaining((r) => (r !== null && r > 0 ? r - 1 : 0));
    }, 1000);

    try {
      const result = await recordAndClone(seconds, voiceName.trim() || 'My Atlas voice');
      setSuccess(true);
      setPickedVoice({
        id: result.voice_id,
        name: voiceName,
        source: 'cloned_record',
      });
      onPicked();
    } catch (err) {
      setError(String(err));
    } finally {
      setRecording(false);
      setRemaining(null);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'var(--cream-mute)',
    marginBottom: 8,
  };
  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(20, 17, 14, 0.55)',
    border: '1px solid var(--hair-strong)',
    color: 'var(--cream)',
    fontSize: 14,
    fontFamily: 'var(--font-serif)',
    outline: 'none',
    transition: 'border-color 180ms ease',
  };
  const helpStyle: React.CSSProperties = {
    marginTop: 8,
    fontSize: 11,
    color: 'var(--cream-faint)',
    fontFamily: 'var(--font-serif)',
    lineHeight: 1.5,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={labelStyle}>Voice name</label>
        <input
          type="text"
          value={voiceName}
          onChange={(e) => setVoiceName(e.target.value)}
          disabled={recording}
          style={fieldStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brass)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--hair-strong)')}
        />
        <p style={helpStyle}>
          Pick anything that helps you tell voices apart later — your partner's name, "calm
          version of me", etc.
        </p>
      </div>

      <div>
        <label style={labelStyle}>Duration ({seconds}s)</label>
        <input
          type="range"
          min={15}
          max={60}
          step={5}
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
          disabled={recording}
          style={{ width: '100%', accentColor: '#c9a04f' }}
        />
        <p style={helpStyle}>
          ElevenLabs IVC works best with 30 seconds of natural speech. Speak normally — mix
          calm with expressive — and avoid heavy background noise.
        </p>
      </div>

      <button
        type="button"
        onClick={start}
        disabled={recording}
        className="mono"
        style={{
          width: '100%',
          padding: '14px',
          background: recording ? 'var(--ink-3)' : 'var(--brass)',
          color: recording ? 'var(--cream-faint)' : 'var(--ink)',
          border: 'none',
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          fontWeight: 600,
          cursor: recording ? 'wait' : 'pointer',
          transition: 'background 180ms ease',
        }}
      >
        {recording
          ? `Recording… ${remaining ?? seconds}s`
          : success
            ? 'Record again'
            : 'Start recording'}
      </button>

      {error ? (
        <p className="mono" style={{ fontSize: 11, color: 'var(--signal-red)' }}>
          {error}
        </p>
      ) : null}
      {success && !recording ? (
        <p
          className="mono"
          style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--sage)' }}
        >
          Cloned voice saved. Continue when ready.
        </p>
      ) : null}
    </div>
  );
}
