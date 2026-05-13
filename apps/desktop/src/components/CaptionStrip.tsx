import { useEffect, useRef } from 'react';
import { useTranscripts } from '../state/transcripts';

/**
 * Bottom-of-window scrolling transcript. Color-coded pill per speaker;
 * older entries fade toward slate-700 so the latest reads strongest.
 * Auto-scrolls to the newest line.
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

  const newestId = entries[entries.length - 1]?.id;

  return (
    <div
      ref={scrollerRef}
      aria-live="polite"
      aria-label="conversation transcript"
      className="absolute bottom-0 inset-x-0 max-h-44 overflow-y-auto px-6 py-3 bg-slate-900/75 backdrop-blur-md border-t border-slate-800"
    >
      <ul className="space-y-2 text-sm max-w-3xl mx-auto">
        {entries.map((entry, i) => {
          const isNewest = entry.id === newestId;
          const distance = entries.length - 1 - i;
          // Fade the older entries down so the active turn reads strongest.
          const textClass =
            distance === 0
              ? 'text-slate-100'
              : distance === 1
                ? 'text-slate-300'
                : distance === 2
                  ? 'text-slate-400'
                  : 'text-slate-500';
          return (
            <li
              key={entry.id}
              className={[
                'flex items-baseline gap-3 transition-colors',
                isNewest ? 'animate-fade-in' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'shrink-0 uppercase tracking-widest text-[9px] px-1.5 py-0.5 rounded-full border',
                  entry.role === 'user'
                    ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30'
                    : 'text-violet-300 border-violet-500/30 bg-violet-950/30',
                ].join(' ')}
              >
                {entry.role === 'user' ? 'you' : 'atlas'}
              </span>
              <span className={`${textClass} leading-relaxed`}>{entry.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
