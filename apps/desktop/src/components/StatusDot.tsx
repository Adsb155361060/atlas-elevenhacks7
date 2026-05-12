import type { AtlasUIState } from '../state/store';

interface Props {
  state: AtlasUIState;
}

const colorByState: Record<AtlasUIState, string> = {
  idle: 'bg-slate-700',
  armed: 'bg-sky-500',
  listening: 'bg-emerald-500',
  thinking: 'bg-amber-500',
  speaking: 'bg-violet-500',
  paused: 'bg-slate-600',
};

const pulseByState: Record<AtlasUIState, string> = {
  idle: '',
  armed: 'animate-ping',
  listening: 'animate-pulse',
  thinking: 'animate-pulse',
  speaking: 'animate-pulse',
  paused: '',
};

export function StatusDot({ state }: Props) {
  return (
    <div
      className={[
        'w-24 h-24 rounded-full ring-2 ring-slate-700/50 flex items-center justify-center',
        'text-slate-100 text-2xl font-light select-none transition-colors duration-200',
        colorByState[state],
        pulseByState[state],
      ].join(' ')}
      aria-label={`Atlas state: ${state}`}
      role="status"
    >
      A
    </div>
  );
}
