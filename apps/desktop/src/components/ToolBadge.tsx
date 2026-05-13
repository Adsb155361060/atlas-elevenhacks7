import { useEffect, useState } from 'react';
import { useToolStatus } from '../state/toolStatus';

/**
 * Tool-name → spoken-friendly verb. Mostly present participles so the chip
 * reads "Generating image…" / "Searching the web…" naturally.
 */
const VERB_BY_TOOL: Record<string, string> = {
  web_search: 'Searching the web',
  generate_image: 'Generating an image',
  generate_music: 'Composing music',
  vision_qa: 'Looking',
  launch_app: 'Opening app',
  music_control: 'Controlling music',
  open_path: 'Opening',
  find_files: 'Searching files',
  system_action: 'Adjusting system',
  take_note: 'Saving note',
  list_notes: 'Looking up notes',
  read_clipboard: 'Reading clipboard',
  write_clipboard: 'Copying to clipboard',
  set_timer: 'Starting timer',
  calendar_today: 'Reading calendar',
  render_artifact: 'Rendering',
};

export function ToolBadge() {
  const inflight = useToolStatus((s) => s.inflight);

  // Crossfade: ToolBadge stays visible briefly after dispatch ends so quick
  // tools don't flicker. Track the most-recent inflight separately.
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    if (inflight.length > 0) {
      const newest = inflight[inflight.length - 1]!;
      setLatest(newest.tool_name);
    } else if (latest !== null) {
      const id = window.setTimeout(() => setLatest(null), 250);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [inflight, latest]);

  if (latest === null) return null;

  const verb = VERB_BY_TOOL[latest] ?? `Running ${latest}`;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 animate-fade-in">
      <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/90 backdrop-blur-md border border-slate-700/60 shadow-lg">
        <Spinner />
        <span className="text-xs text-slate-200">{verb}…</span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-400 animate-spin"
      aria-hidden="true"
    >
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  );
}
