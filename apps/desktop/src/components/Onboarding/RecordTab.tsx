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
          disabled={recording}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-sm focus:outline-none focus:border-emerald-500/60"
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          Pick anything that helps you tell voices apart later — your partner's name, "calm version of me", etc.
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
          Duration ({seconds}s)
        </label>
        <input
          type="range"
          min={15}
          max={60}
          step={5}
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
          disabled={recording}
          className="w-full"
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          ElevenLabs IVC works best with 30 seconds of natural speech. Speak normally — mix
          calm with expressive — and avoid heavy background noise.
        </p>
      </div>

      <button
        type="button"
        onClick={start}
        disabled={recording}
        className="w-full px-4 py-3 rounded-md bg-emerald-500 text-slate-950 font-medium text-sm hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
      >
        {recording
          ? `Recording… ${remaining ?? seconds}s`
          : success
            ? 'Record again'
            : 'Start recording'}
      </button>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {success && !recording ? (
        <p className="text-sm text-emerald-400">Cloned voice saved. Continue when ready.</p>
      ) : null}
    </div>
  );
}
