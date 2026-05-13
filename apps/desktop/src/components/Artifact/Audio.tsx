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
    return <p className="text-sm text-slate-500">No audio source provided.</p>;
  }

  const duration =
    typeof d.duration_ms === 'number'
      ? `${(d.duration_ms / 1000).toFixed(1)}s`
      : null;

  return (
    <div className="space-y-3">
      {d.prompt || d.title ? (
        <div className="space-y-0.5">
          {d.title ? <h3 className="text-sm font-medium text-slate-100">{d.title}</h3> : null}
          {d.prompt ? (
            <p className="text-xs text-slate-400 italic">"{d.prompt}"</p>
          ) : null}
        </div>
      ) : null}
      <audio
        ref={ref}
        src={src}
        controls
        className="w-full"
      />
      {duration ? (
        <p className="text-[10px] text-slate-600 text-right">
          duration {duration}
        </p>
      ) : null}
    </div>
  );
}
