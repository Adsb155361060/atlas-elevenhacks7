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
 * Shared chrome for every onboarding screen — brass-and-ink edition.
 * Progress dots top-left, big serif title, content slot, sticky action row
 * with brass primary + ghost secondary. Same cockpit-stage grain backdrop
 * as the main app so onboarding feels continuous, not a separate world.
 */
export function OnboardingShell(props: ShellProps) {
  const { step, total, title, subtitle, children, primary, secondary } = props;
  return (
    <div
      className="cockpit-stage"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--cream)',
      }}
    >
      <header
        style={{
          padding: '32px 48px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{
              height: 2,
              width: i === step ? 48 : 24,
              background: i === step ? 'var(--brass)' : 'var(--cream-faint)',
              transition: 'all 280ms ease',
              display: 'inline-block',
            }}
          />
        ))}
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 48px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 640 }}>
          <h1
            className="serif"
            style={{
              fontSize: 40,
              fontWeight: 300,
              fontVariationSettings: '"opsz" 60, "SOFT" 30, "WONK" 1',
              letterSpacing: '-0.015em',
              lineHeight: 1.1,
              margin: 0,
              color: 'var(--cream)',
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              className="serif-body"
              style={{
                marginTop: 14,
                fontSize: 17,
                lineHeight: 1.55,
                color: 'var(--cream-mute)',
                maxWidth: 540,
              }}
            >
              {subtitle}
            </p>
          ) : null}
          <div style={{ marginTop: 36 }}>{children}</div>
        </div>
      </main>

      <footer
        style={{
          padding: '20px 48px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--hair)',
        }}
      >
        <div>
          {secondary ? (
            <button
              type="button"
              onClick={secondary.onClick}
              className="mono"
              style={{
                background: 'transparent',
                border: '1px solid var(--hair-strong)',
                color: 'var(--cream-mute)',
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                padding: '10px 16px',
                cursor: 'pointer',
                transition: 'all 180ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--brass)';
                e.currentTarget.style.color = 'var(--cream)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--hair-strong)';
                e.currentTarget.style.color = 'var(--cream-mute)';
              }}
            >
              {secondary.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="mono"
          style={{
            background: primary.disabled ? 'var(--ink-3)' : 'var(--brass)',
            color: primary.disabled ? 'var(--cream-faint)' : 'var(--ink)',
            border: 'none',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            padding: '12px 28px',
            cursor: primary.disabled ? 'not-allowed' : 'pointer',
            transition: 'all 180ms ease',
            boxShadow: primary.disabled
              ? 'none'
              : '0 0 24px rgba(201, 160, 79, 0.25)',
          }}
        >
          {primary.label}
        </button>
      </footer>
    </div>
  );
}
