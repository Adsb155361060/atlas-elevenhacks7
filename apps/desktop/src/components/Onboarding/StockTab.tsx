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
      <p className="mono" style={{ fontSize: 12, color: 'var(--signal-red)' }}>
        Couldn't load the voice library. {error}
      </p>
    );
  }
  if (voices === null) {
    return (
      <p className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-mute)' }}>
        Loading voices…
      </p>
    );
  }
  if (voices.length === 0) {
    return (
      <p className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-mute)' }}>
        No voices available.
      </p>
    );
  }

  return (
    <ul
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 8,
        maxHeight: 288,
        overflowY: 'auto',
        paddingRight: 4,
        margin: 0,
        listStyle: 'none',
      }}
    >
      {voices.map((v) => (
        <li key={v.voice_id}>
          <button
            type="button"
            onClick={() => choose(v)}
            disabled={busy !== null}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '10px 14px',
              background: 'transparent',
              border: '1px solid var(--hair-strong)',
              color: 'var(--cream)',
              cursor: busy !== null ? 'wait' : 'pointer',
              opacity: busy !== null ? 0.5 : 1,
              transition: 'all 180ms ease',
            }}
            onMouseEnter={(e) => {
              if (busy === null) e.currentTarget.style.borderColor = 'var(--brass)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--hair-strong)';
            }}
          >
            <div
              className="serif-body"
              style={{
                fontSize: 15,
                color: 'var(--cream)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {v.name}
            </div>
            {v.category ? (
              <div
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: 'var(--cream-faint)',
                  marginTop: 2,
                }}
              >
                {v.category}
              </div>
            ) : null}
            {v.preview_url ? (
              <audio
                src={v.preview_url}
                controls
                preload="none"
                style={{ marginTop: 8, width: '100%', height: 28 }}
              />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
