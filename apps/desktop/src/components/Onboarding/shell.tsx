import type { ReactNode } from 'react';

interface ShellProps {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primary: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void };
}

/**
 * Shared chrome for every onboarding screen: progress dots, title block,
 * content slot, and a sticky action row at the bottom.
 */
export function OnboardingShell(props: ShellProps) {
  const { step, total, title, subtitle, children, primary, secondary } = props;
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="pt-6 px-8 flex items-center gap-2">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={[
              'h-1.5 rounded-full transition-all',
              i === step ? 'w-12 bg-emerald-500' : 'w-6 bg-slate-700',
            ].join(' ')}
          />
        ))}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-8 py-10">
        <div className="w-full max-w-xl">
          <h1 className="text-3xl font-light tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="mt-3 text-slate-400 text-base leading-relaxed">{subtitle}</p>
          ) : null}
          <div className="mt-8">{children}</div>
        </div>
      </main>

      <footer className="px-8 pb-8 flex items-center justify-between border-t border-slate-800/60 pt-5">
        <div>
          {secondary ? (
            <button
              type="button"
              onClick={secondary.onClick}
              className="text-sm text-slate-400 hover:text-slate-200 px-3 py-2 rounded transition-colors"
            >
              {secondary.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="text-sm font-medium px-5 py-2.5 rounded-md bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
        >
          {primary.label}
        </button>
      </footer>
    </div>
  );
}
