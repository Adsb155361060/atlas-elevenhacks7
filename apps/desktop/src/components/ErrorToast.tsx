import { useEffect } from 'react';
import { useToolStatus } from '../state/toolStatus';

const AUTO_DISMISS_MS = 6_000;

const FRIENDLY_TOOL_NAME: Record<string, string> = {
  vision_qa: 'vision',
  web_search: 'web search',
  generate_image: 'image generation',
  generate_music: 'music generation',
  launch_app: 'app launcher',
  music_control: 'music control',
  open_path: 'open path',
  find_files: 'file search',
  system_action: 'system control',
  take_note: 'note saving',
  list_notes: 'note lookup',
  read_clipboard: 'clipboard',
  write_clipboard: 'clipboard',
  set_timer: 'timer',
  calendar_today: 'calendar',
  render_artifact: 'artifact rendering',
};

export function ErrorToast() {
  const lastError = useToolStatus((s) => s.lastError);
  const dismiss = useToolStatus((s) => s.dismissError);

  useEffect(() => {
    if (!lastError) return undefined;
    const id = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [lastError, dismiss]);

  if (!lastError) return null;

  const friendly = FRIENDLY_TOOL_NAME[lastError.tool_name] ?? lastError.tool_name;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 50,
        maxWidth: 360,
        animation: 'atlas-fade-in 220ms ease',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(20, 17, 14, 0.94)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(184, 88, 65, 0.5)',
          borderLeft: '2px solid var(--signal-red)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--signal-red)',
            }}
          >
            {friendly} couldn't run
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--cream-mute)',
              fontSize: 14,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cream)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cream-mute)')}
          >
            ×
          </button>
        </div>
        <p
          className="serif-body"
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--cream)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {lastError.message}
        </p>
      </div>
    </div>
  );
}
