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
    return <p className="text-sm text-slate-500">No image source provided.</p>;
  }
  if (errored) {
    return (
      <p className="text-sm text-rose-400">
        Image failed to load. Source: <code className="text-xs">{src.slice(0, 80)}…</code>
      </p>
    );
  }
  return (
    <figure className="space-y-2">
      <img
        src={src}
        alt={d.alt ?? d.caption ?? 'generated image'}
        onError={() => setErrored(true)}
        className="rounded-md border border-slate-800 max-h-[480px] mx-auto"
      />
      {d.caption ? (
        <figcaption className="text-xs text-slate-500 text-center">{d.caption}</figcaption>
      ) : null}
    </figure>
  );
}
