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

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
          Voice name
        </label>
        <input
          type="text"
          value={voiceName}
          onChange={(e) => setVoiceName(e.target.value)}
          disabled={busy}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-sm focus:outline-none focus:border-emerald-500/60"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
          Audio file
        </label>
        <input
          type="file"
          accept={ACCEPTED}
          onChange={onFileChange}
          disabled={busy}
          className="block w-full text-sm text-slate-300 file:mr-3 file:px-3 file:py-2 file:bg-slate-900 file:border file:border-slate-800 file:rounded-md file:text-slate-200 file:text-xs hover:file:border-emerald-500/60"
        />
        {filename ? (
          <p className="mt-1.5 text-[11px] text-slate-500">
            Selected: <span className="text-slate-300">{filename}</span>
            {' '}({bytes ? Math.round(bytes.length / 1024) : 0} KB)
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!bytes || busy}
        className="w-full px-4 py-3 rounded-md bg-emerald-500 text-slate-950 font-medium text-sm hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
      >
        {busy ? 'Uploading…' : 'Clone this voice'}
      </button>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
    </div>
  );
}
