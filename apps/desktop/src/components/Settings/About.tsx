import { useEffect, useState } from 'react';
import { getAppInfo, type AppInfo } from '../../ipc/settings';

export function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    getAppInfo().then(setInfo).catch(() => undefined);
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-light tracking-tight">About Atlas</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        A voice-first desktop assistant. Built on ElevenLabs (Conversational Agent +
        Scribe v2 + Flash v2.5 + Instant Voice Clone) and Claude.
      </p>

      <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">Version</dt>
        <dd className="text-slate-200 font-mono">{info?.version ?? '…'}</dd>
        <dt className="text-slate-500">Platform</dt>
        <dd className="text-slate-200 font-mono">
          {info ? `${info.target_os} / ${info.target_arch}` : '…'}
        </dd>
        <dt className="text-slate-500">Build</dt>
        <dd className="text-slate-200">{info?.debug ? 'debug' : 'release'}</dd>
      </dl>

      <p className="mt-8 text-[11px] text-slate-600 leading-relaxed max-w-md">
        ATLAS is the dev-time working name. The public name will change before public
        launch (ADR 0001). The accessibility-first wedge is the lead positioning
        (ADR 0002).
      </p>
    </section>
  );
}
