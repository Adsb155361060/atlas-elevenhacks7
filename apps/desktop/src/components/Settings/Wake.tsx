import { useEffect, useState } from 'react';
import { useAtlasState, type AtlasUIState } from '../../state/store';
import { setState as setBackendState } from '../../ipc/state';

const HOTKEY_BY_OS = (() => {
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(ua)) return '⌘ + Shift + A';
  return 'Ctrl + Shift + A';
})();

export function Wake() {
  const currentState = useAtlasState((s) => s.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The wake-word module pauses itself when global AtlasState transitions to
  // Paused. Toggling this switch is just toggling that state.
  const wakeEnabled = currentState !== 'paused';

  // When the user pauses then unpauses, we want to return to 'idle' rather
  // than whatever transitional state was active when they paused.
  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const target: AtlasUIState = next ? 'idle' : 'paused';
      await setBackendState(target);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Reset transient error when state changes from elsewhere.
  useEffect(() => {
    setError(null);
  }, [currentState]);

  return (
    <section>
      <h1 className="text-2xl font-light tracking-tight">Wake word</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        Atlas listens for <span className="text-emerald-400 font-mono">"Hey Atlas"</span> when wake is on.
        Pausing keeps the mic ignored unless you push-to-talk.
      </p>

      <label className="mt-6 flex items-center justify-between gap-4 rounded-md border border-slate-800 bg-slate-900/40 px-5 py-4 cursor-pointer">
        <div>
          <div className="text-base text-slate-100 font-medium">
            Enable wake-word detection
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            When off, the on-device detector pauses. The push-to-talk hotkey still works.
          </div>
        </div>
        <input
          type="checkbox"
          checked={wakeEnabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="w-4 h-4 accent-emerald-500"
        />
      </label>

      <div className="mt-3 rounded-md border border-slate-800 bg-slate-900/40 px-5 py-4">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">
          Push-to-talk hotkey
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-4">
          <div className="font-mono text-slate-200">{HOTKEY_BY_OS}</div>
          <div className="text-[11px] text-slate-500">
            Rebinding lands in a later phase
          </div>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
    </section>
  );
}
