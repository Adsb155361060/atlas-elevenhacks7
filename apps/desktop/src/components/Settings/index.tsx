import { useView } from '../../state/view';
import { Sidebar } from './Sidebar';
import { Voice } from './Voice';
import { Wake } from './Wake';
import { Privacy } from './Privacy';
import { About } from './About';

export function Settings() {
  const section = useView((s) => s.settingsSection);
  const setView = useView((s) => s.setView);

  return (
    <div
      className="cockpit-stage"
      style={{
        minHeight: '100vh',
        display: 'flex',
        color: 'var(--cream)',
      }}
    >
      <Sidebar />
      <main
        style={{
          flex: 1,
          padding: '48px 56px',
          overflowY: 'auto',
        }}
      >
        <div style={{ maxWidth: 720 }}>
          {section === 'voice' ? (
            <Voice onPickAgain={() => setView('home')} />
          ) : null}
          {section === 'wake' ? <Wake /> : null}
          {section === 'privacy' ? <Privacy /> : null}
          {section === 'about' ? <About /> : null}
        </div>
      </main>
    </div>
  );
}
