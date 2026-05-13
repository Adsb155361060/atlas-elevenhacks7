/**
 * HUD — coordinate grid + four telemetry corners. Composes the
 * always-present cockpit chrome. The Orb + CaptionRail render on top of it.
 *
 * Includes its own CSS for the telemetry layout (positions, typography).
 * Kept inline so the HUD is self-contained and the rest of the app's
 * components/* tree doesn't need to know about its styling.
 */

import { useRef } from 'react';
import type { CockpitState } from '../../state/cockpit';
import type { AudioLevel } from '../../state/audio';
import { CoordinateGrid, GridLabels } from './CoordinateGrid';
import { BLCorner, BRCorner, TLCorner, TRCorner, useMouseCoord } from './telemetry';

const HUD_CSS = `
  .telemetry {
    position: absolute;
    color: var(--cream-mute);
    font-size: 11px;
    line-height: 1.6;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    user-select: none;
    pointer-events: none;
  }
  .telemetry.tl { top: 40px; left: 48px; }
  .telemetry.tr { top: 40px; right: 48px; text-align: right; }
  .telemetry.bl { bottom: 40px; left: 48px; }
  .telemetry.br { bottom: 40px; right: 48px; text-align: right; }
  .telemetry .row { display: flex; gap: 14px; align-items: baseline; }
  .telemetry.tr .row, .telemetry.br .row { justify-content: flex-end; }
  .telemetry .row.title { color: var(--cream); margin-bottom: 6px; }
  .telemetry .row.title .brand {
    font-family: var(--font-serif);
    text-transform: none;
    letter-spacing: 0.02em;
    font-size: 18px;
    font-weight: 400;
    font-style: italic;
    color: var(--cream);
    margin-right: 12px;
    transform: translateY(1px);
    display: inline-block;
  }
  .telemetry .lbl { color: var(--cream-faint); min-width: 64px; }
  .telemetry.tr .lbl, .telemetry.br .lbl { min-width: 0; }
  .telemetry .val { color: var(--cream-dim); }
  .telemetry .val.brass { color: var(--brass); }
  .telemetry .sep { color: var(--cream-faint); margin: 0 8px; }
  .telemetry .row.wave { align-items: center; }
`;

interface HUDProps {
  state: CockpitState;
  audio: AudioLevel;
  source: 'session' | 'simulated' | 'off';
  gridOpacity: number;
  conversationId: string | null;
  model?: string;
  appVersion?: string;
}

export function HUD({
  state,
  audio,
  source,
  gridOpacity,
  conversationId,
  model = 'CLAUDE OPUS 4.7',
  appVersion = '0.1.0',
}: HUDProps) {
  const mouse = useMouseCoord();
  // Stable per-window session-id surfaced when the agent hasn't given us a
  // real conversation_id yet. 4-digit hex; persists for the lifetime of the
  // window.
  const sessionId = useRef(
    Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0'),
  ).current;
  const focusCol = Math.min(15, Math.floor(mouse.x * 16));
  const focusRow = Math.min(8, Math.floor(mouse.y * 9));
  return (
    <>
      <style>{HUD_CSS}</style>
      <CoordinateGrid opacity={gridOpacity} />
      <GridLabels opacity={gridOpacity * 2.6} focusCol={focusCol} focusRow={focusRow} />
      <TLCorner state={state} sessionId={sessionId} conversationId={conversationId} />
      <TRCorner state={state} audio={audio} mouse={mouse} model={model} />
      <BLCorner audio={audio} source={source} />
      <BRCorner state={state} version={appVersion} />
    </>
  );
}
