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
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 px-10 py-10 overflow-y-auto">
        <div className="max-w-2xl">
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
