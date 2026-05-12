import { useState } from 'react';
import { useOnboarding } from '../../state/onboarding';
import { OnboardingShell } from './shell';
import { StockTab } from './StockTab';
import { RecordTab } from './RecordTab';
import { UploadTab } from './UploadTab';

type Tab = 'stock' | 'record' | 'upload';

const TAB_LABEL: Record<Tab, string> = {
  stock: 'Pick a voice',
  record: 'Record 30 seconds',
  upload: 'Upload a clip',
};

const TAB_SUBTITLE: Record<Tab, string> = {
  stock: "Choose from ElevenLabs's library.",
  record:
    "Record your own voice — or someone whose voice would feel right hearing back. Atlas will sound like them.",
  upload:
    'Already have a clean recording? Drop it in (wav, mp3, m4a, ogg, flac, webm).',
};

export function VoicePicker() {
  const [tab, setTab] = useState<Tab>('stock');
  const next = useOnboarding((s) => s.next);
  const back = useOnboarding((s) => s.back);
  const pickedVoice = useOnboarding((s) => s.pickedVoice);

  return (
    <OnboardingShell
      step={1}
      total={4}
      title="What should Atlas sound like?"
      subtitle={TAB_SUBTITLE[tab]}
      primary={{
        label: pickedVoice ? `Continue with ${pickedVoice.name}` : 'Continue',
        onClick: next,
        disabled: !pickedVoice,
      }}
      secondary={{ label: 'Back', onClick: back }}
    >
      <div role="tablist" className="flex gap-1 mb-5 border-b border-slate-800">
        {(['stock', 'record', 'upload'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={[
              'px-3 py-2 text-xs uppercase tracking-wider transition-colors -mb-px border-b',
              tab === t
                ? 'text-emerald-400 border-emerald-500'
                : 'text-slate-500 hover:text-slate-300 border-transparent',
            ].join(' ')}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'stock' ? <StockTab onPicked={() => undefined} /> : null}
      {tab === 'record' ? <RecordTab onPicked={() => undefined} /> : null}
      {tab === 'upload' ? <UploadTab onPicked={() => undefined} /> : null}
    </OnboardingShell>
  );
}
