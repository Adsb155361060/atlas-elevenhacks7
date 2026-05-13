import { useFirstRun } from '../state/firstRun';

interface Capability {
  emoji: string;
  title: string;
  example: string;
}

const CAPABILITIES: Capability[] = [
  { emoji: '🎙️', title: 'Speak naturally', example: "Hold ⌘ + Shift + A and just talk." },
  { emoji: '🌐', title: 'Live web search', example: '"What\'s the weather in Lagos tomorrow?"' },
  { emoji: '🎨', title: 'Generate images', example: '"Draw a watercolour fox in moonlight."' },
  { emoji: '🎵', title: 'Generate music', example: '"Make me a 30-second lo-fi loop."' },
  { emoji: '👁️', title: 'See your screen + camera', example: '"What\'s on my screen?"' },
  { emoji: '📅', title: 'Read your calendar', example: '"What\'s on my schedule today?"' },
  { emoji: '📝', title: 'Take notes', example: '"Make a note that the API spec changed."' },
  { emoji: '⏱️', title: 'Set timers', example: '"Set a 10-minute timer for the pasta."' },
];

export function FirstRunTutorial() {
  const dismissed = useFirstRun((s) => s.dismissed);
  const setDismissed = useFirstRun((s) => s.setDismissed);

  if (dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    // localStorage is sufficient — this is per-install UX hint, not data.
    try {
      window.localStorage.setItem('atlas:first_run_dismissed', 'true');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm animate-fade-in">
      <div className="max-w-2xl w-full mx-4 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <header className="px-6 py-5 border-b border-slate-800/60">
          <p className="text-[10px] uppercase tracking-widest text-emerald-400">
            Atlas, in eight things
          </p>
          <h2 className="mt-1 text-2xl font-light text-slate-100">
            Talk to your computer. It can actually do these.
          </h2>
        </header>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-3 p-6">
          {CAPABILITIES.map((c) => (
            <li key={c.title} className="flex gap-3">
              <span aria-hidden className="text-xl shrink-0">
                {c.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">{c.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{c.example}</p>
              </div>
            </li>
          ))}
        </ul>
        <footer className="px-6 py-4 border-t border-slate-800/60 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            You can re-open this any time from Settings → About.
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-2 rounded-md bg-emerald-500 text-slate-950 text-sm font-medium hover:bg-emerald-400 transition-colors"
          >
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
