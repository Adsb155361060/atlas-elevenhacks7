/**
 * Small, reusable building blocks for the brass-and-ink Settings panel.
 * Centralised so every Settings sub-page reads the same — and so a future
 * design tweak only touches one file.
 */

import type { CSSProperties, ReactNode } from 'react';

export function SettingsHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      className="serif"
      style={{
        margin: 0,
        fontSize: 36,
        fontWeight: 300,
        fontStyle: 'italic',
        fontVariationSettings: '"opsz" 60, "SOFT" 30',
        letterSpacing: '-0.015em',
        color: 'var(--cream)',
      }}
    >
      {children}
    </h1>
  );
}

export function SettingsSubtitle({ children }: { children: ReactNode }) {
  return (
    <p
      className="serif-body"
      style={{
        margin: '8px 0 0',
        fontSize: 15,
        lineHeight: 1.55,
        color: 'var(--cream-mute)',
        maxWidth: 580,
      }}
    >
      {children}
    </p>
  );
}

export function SettingsLabel({
  children,
  tone = 'mute',
}: {
  children: ReactNode;
  tone?: 'mute' | 'brass';
}) {
  return (
    <p
      className="mono"
      style={{
        margin: 0,
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: tone === 'brass' ? 'var(--brass)' : 'var(--cream-mute)',
      }}
    >
      {children}
    </p>
  );
}

export function SettingsCard({
  children,
  style,
  tone = 'default',
}: {
  children: ReactNode;
  style?: CSSProperties;
  tone?: 'default' | 'danger';
}) {
  const danger = tone === 'danger';
  return (
    <div
      style={{
        marginTop: 24,
        padding: '20px 24px',
        background: danger ? 'rgba(184, 88, 65, 0.07)' : 'rgba(20, 17, 14, 0.55)',
        border: `1px solid ${danger ? 'rgba(184, 88, 65, 0.45)' : 'var(--hair-strong)'}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface GhostButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function GhostButton({ onClick, disabled, children }: GhostButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mono"
      style={{
        background: 'transparent',
        border: '1px solid var(--hair-strong)',
        color: disabled ? 'var(--cream-faint)' : 'var(--cream)',
        padding: '10px 18px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 180ms ease',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = 'var(--brass)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--hair-strong)';
      }}
    >
      {children}
    </button>
  );
}

interface DangerButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function DangerButton({ onClick, disabled, children }: DangerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mono"
      style={{
        background: disabled ? 'var(--ink-3)' : 'var(--signal-red)',
        color: disabled ? 'var(--cream-faint)' : 'var(--cream)',
        border: 'none',
        padding: '10px 18px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
