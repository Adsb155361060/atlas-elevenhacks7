import { useView, type SettingsSection } from '../../state/view';

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'voice', label: 'Voice' },
  { id: 'wake', label: 'Wake word' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'about', label: 'About' },
];

export function Sidebar() {
  const settingsSection = useView((s) => s.settingsSection);
  const setSettingsSection = useView((s) => s.setSettingsSection);
  const setView = useView((s) => s.setView);

  return (
    <aside className="w-44 shrink-0 border-r border-slate-800/60 px-4 py-6">
      <button
        type="button"
        onClick={() => setView('home')}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 mb-6 transition-colors"
      >
        <span aria-hidden>←</span>
        <span>Back to Atlas</span>
      </button>
      <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
        Settings
      </h2>
      <nav>
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSettingsSection(s.id)}
                className={[
                  'w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors',
                  s.id === settingsSection
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900',
                ].join(' ')}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
