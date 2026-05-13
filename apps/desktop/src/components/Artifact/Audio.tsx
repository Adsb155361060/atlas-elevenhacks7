import { useEffect, useRef } from 'react';

interface AudioData {
  /** Either a hosted URL or a `data:audio/...;base64,…` URI. */
  url?: string;
  src?: string;
  /** Spelled `audio_data_uri` to match the `generate_music` tool result. */
  audio_data_uri?: string;
  title?: string;
  prompt?: string;
  duration_ms?: number;
  /** Auto-play on render? Defaults true for newly-generated music. */
  autoplay?: boolean;
}

export function AudioArtifact({ data }: { data: unknown }) {
  const d = (data as AudioData) ?? {};
  const src = d.audio_data_uri ?? d.url ?? d.src ?? '';
  const ref = useRef<HTMLAudioElement | null>(null);
  const autoplay = d.autoplay ?? true;

  useEffect(() => {
    if (autoplay && ref.current) {
      ref.current.play().catch(() => undefined);
    }
  }, [src, autoplay]);

  if (!src) {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-faint)' }}
      >
        No audio source provided
      </p>
    );
  }

  const duration =
    typeof d.duration_ms === 'number'
      ? `${(d.duration_ms / 1000).toFixed(1)}s`
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {d.prompt || d.title ? (
        <div>
          {d.title ? (
            <h3
              className="serif"
              style={{
                margin: 0,
                fontSize: 18,
                fontStyle: 'italic',
                color: 'var(--cream)',
                fontVariationSettings: '"opsz" 36, "SOFT" 30',
              }}
            >
              {d.title}
            </h3>
          ) : null}
          {d.prompt ? (
            <p
              className="serif-body"
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                fontStyle: 'italic',
                color: 'var(--cream-mute)',
              }}
            >
              "{d.prompt}"
            </p>
          ) : null}
        </div>
      ) : null}
      <audio ref={ref} src={src} controls style={{ width: '100%' }} />
      {duration ? (
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--cream-faint)',
            textAlign: 'right',
          }}
        >
          duration {duration}
        </p>
      ) : null}
    </div>
  );
}
