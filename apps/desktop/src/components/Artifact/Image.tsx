import { useState } from 'react';

interface ImageData {
  url?: string;
  src?: string;
  /** Optional base64 data URI alt for generated images that aren't hosted. */
  data_uri?: string;
  alt?: string;
  caption?: string;
}

export function ImageArtifact({ data }: { data: unknown }) {
  const d = (data as ImageData) ?? {};
  const src = d.url ?? d.src ?? d.data_uri ?? '';
  const [errored, setErrored] = useState(false);
  if (!src) {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-faint)' }}
      >
        No image source provided
      </p>
    );
  }
  if (errored) {
    return (
      <p
        className="serif-body"
        style={{ fontSize: 13, color: 'var(--signal-red)' }}
      >
        Image failed to load.{' '}
        <code className="mono" style={{ fontSize: 11, color: 'var(--cream-mute)' }}>
          {src.slice(0, 80)}…
        </code>
      </p>
    );
  }
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <img
        src={src}
        alt={d.alt ?? d.caption ?? 'generated image'}
        onError={() => setErrored(true)}
        style={{
          border: '1px solid var(--hair-strong)',
          maxHeight: 480,
          margin: '0 auto',
          display: 'block',
        }}
      />
      {d.caption ? (
        <figcaption
          className="serif-body"
          style={{
            fontSize: 12,
            fontStyle: 'italic',
            color: 'var(--cream-mute)',
            textAlign: 'center',
          }}
        >
          {d.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
