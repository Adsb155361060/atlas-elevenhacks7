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
    <div className="fixed top-4 right-4 z-50 max-w-sm animate-fade-in">
      <div className="px-4 py-3 rounded-md bg-rose-950/90 border border-rose-700/70 backdrop-blur-md shadow-lg">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] uppercase tracking-widest text-rose-300">
            {friendly} couldn't run
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="text-rose-300 hover:text-rose-100 text-xs leading-none"
          >
            ×
          </button>
        </div>
        <p className="mt-1.5 text-xs text-rose-100 leading-relaxed line-clamp-3">
          {lastError.message}
        </p>
      </div>
    </div>
  );
}
