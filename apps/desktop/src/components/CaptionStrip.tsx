import { useEffect, useRef } from 'react';
import { useTranscripts } from '../state/transcripts';

/**
 * Bottom-of-window scrolling transcript. Renders the last N transcript turns
 * (user + agent), color-coded by speaker, auto-scrolling to the latest. Empty
 * when no session is active.
 */
export function CaptionStrip() {
  const entries = useTranscripts((s) => s.entries);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, entries[entries.length - 1]?.text]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      ref={scrollerRef}
      aria-live="polite"
      aria-label="conversation transcript"
      className="absolute bottom-0 inset-x-0 max-h-48 overflow-y-auto px-6 py-3 bg-slate-900/70 backdrop-blur-sm border-t border-slate-800 text-sm"
    >
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-2">
            <span
              className={[
                'shrink-0 uppercase tracking-widest text-[10px] pt-0.5',
                entry.role === 'user' ? 'text-emerald-400/80' : 'text-violet-400/80',
              ].join(' ')}
            >
              {entry.role === 'user' ? 'you' : 'atlas'}
            </span>
            <span className="text-slate-200">{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
