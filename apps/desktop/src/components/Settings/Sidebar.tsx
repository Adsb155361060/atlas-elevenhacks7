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
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--hair-strong)',
        padding: '32px 24px',
      }}
    >
      <button
        type="button"
        onClick={() => setView('home')}
        className="mono"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--cream-mute)',
          fontSize: 10,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cream)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cream-mute)')}
      >
        <span aria-hidden>←</span>
        <span>Back to Atlas</span>
      </button>
      <h2
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--brass)',
          marginBottom: 14,
          margin: '0 0 14px',
        }}
      >
        Settings
      </h2>
      <nav>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTIONS.map((s) => {
            const active = s.id === settingsSection;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSettingsSection(s.id)}
                  className="serif"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    background: active ? 'rgba(201, 160, 79, 0.12)' : 'transparent',
                    border: 'none',
                    borderLeft: `2px solid ${active ? 'var(--brass)' : 'transparent'}`,
                    color: active ? 'var(--cream)' : 'var(--cream-mute)',
                    fontSize: 15,
                    fontStyle: active ? 'italic' : 'normal',
                    cursor: 'pointer',
                    transition: 'all 180ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--cream)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--cream-mute)';
                  }}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
