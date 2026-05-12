import { useEffect, useState } from 'react';
import {
  listStockVoices,
  setPrefs,
  type StockVoice,
} from '../../ipc/voice-prefs';
import { useOnboarding } from '../../state/onboarding';

interface StockTabProps {
  onPicked: () => void;
}

export function StockTab({ onPicked }: StockTabProps) {
  const [voices, setVoices] = useState<StockVoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const setPickedVoice = useOnboarding((s) => s.setPickedVoice);

  useEffect(() => {
    let cancelled = false;
    listStockVoices()
      .then((r) => {
        if (cancelled) return;
        const list = (r.raw.voices ?? []).slice(0, 24);
        setVoices(list);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (voice: StockVoice) => {
    try {
      setBusy(voice.voice_id);
      await setPrefs(voice.voice_id, voice.name, 'stock');
      setPickedVoice({ id: voice.voice_id, name: voice.name, source: 'stock' });
      onPicked();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <p className="text-sm text-rose-400">
        Couldn't load the voice library. {error}
      </p>
    );
  }
  if (voices === null) {
    return <p className="text-sm text-slate-400">Loading voices…</p>;
  }
  if (voices.length === 0) {
    return <p className="text-sm text-slate-400">No voices available.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
      {voices.map((v) => (
        <li key={v.voice_id}>
          <button
            type="button"
            onClick={() => choose(v)}
            disabled={busy !== null}
            className="w-full text-left px-3 py-2.5 rounded-md border border-slate-800 hover:border-emerald-500/60 hover:bg-slate-900/60 disabled:opacity-50 transition-colors"
          >
            <div className="text-sm font-medium text-slate-100 truncate">
              {v.name}
            </div>
            {v.category ? (
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">
                {v.category}
              </div>
            ) : null}
            {v.preview_url ? (
              <audio
                src={v.preview_url}
                controls
                preload="none"
                className="mt-1.5 w-full h-8"
              />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
