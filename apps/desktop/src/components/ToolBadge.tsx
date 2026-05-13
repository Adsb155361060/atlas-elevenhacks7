import { useEffect, useState } from 'react';
import { useToolStatus } from '../state/toolStatus';

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
    <div
      style={{
        position: 'fixed',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        animation: 'atlas-fade-in 220ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 18px',
          background: 'rgba(20, 17, 14, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--hair-strong)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        }}
      >
        <Spinner />
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--brass)',
          }}
        >
          {verb}…
        </span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--brass)', animation: 'atlas-spin 1.1s linear infinite' }}
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
