import { useState } from 'react';
import { uploadAndClone } from '../../ipc/voice-prefs';
import { useOnboarding } from '../../state/onboarding';

interface UploadTabProps {
  onPicked: () => void;
}

const ACCEPTED = '.wav,.mp3,.m4a,.mp4,.ogg,.flac,.webm';

export function UploadTab({ onPicked }: UploadTabProps) {
  const [voiceName, setVoiceName] = useState('My Atlas voice');
  const [filename, setFilename] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPickedVoice = useOnboarding((s) => s.setPickedVoice);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('File too large (max 25 MB).');
      return;
    }
    const buf = await file.arrayBuffer();
    setBytes(new Uint8Array(buf));
    setFilename(file.name);
  };

  const submit = async () => {
    if (!bytes || !filename) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadAndClone(bytes, filename, voiceName.trim() || 'My Atlas voice');
      setPickedVoice({
        id: result.voice_id,
        name: voiceName,
        source: 'cloned_upload',
      });
      onPicked();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
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
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={labelStyle}>Voice name</label>
        <input
          type="text"
          value={voiceName}
          onChange={(e) => setVoiceName(e.target.value)}
          disabled={busy}
          style={fieldStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brass)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--hair-strong)')}
        />
      </div>

      <div>
        <label style={labelStyle}>Audio file</label>
        <input
          type="file"
          accept={ACCEPTED}
          onChange={onFileChange}
          disabled={busy}
          className="mono"
          style={{
            display: 'block',
            width: '100%',
            fontSize: 12,
            color: 'var(--cream-dim)',
          }}
        />
        {filename ? (
          <p
            className="mono"
            style={{
              marginTop: 8,
              fontSize: 11,
              letterSpacing: '0.08em',
              color: 'var(--cream-mute)',
            }}
          >
            Selected: <span style={{ color: 'var(--cream)' }}>{filename}</span>{' '}
            ({bytes ? Math.round(bytes.length / 1024) : 0} KB)
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!bytes || busy}
        className="mono"
        style={{
          width: '100%',
          padding: '14px',
          background: !bytes || busy ? 'var(--ink-3)' : 'var(--brass)',
          color: !bytes || busy ? 'var(--cream-faint)' : 'var(--ink)',
          border: 'none',
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          fontWeight: 600,
          cursor: !bytes || busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Uploading…' : 'Clone this voice'}
      </button>

      {error ? (
        <p className="mono" style={{ fontSize: 11, color: 'var(--signal-red)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
