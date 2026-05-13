import type { AtlasUIState } from './store';

/**
 * The reference design's state machine has six states. Atlas's wire state
 * machine (the one tracked in Rust + emitted via `atlas:state`) has six
 * too, but the names don't quite line up. This mapping is the single point
 * of translation between them.
 *
 * Atlas wire     → Cockpit visual
 * ──────────────   ─────────────────
 * idle           → idle
 * armed          → wake          (transitional ping)
 * listening      → listening
 * thinking       → thinking
 * speaking       → speaking
 * paused         → idle          (cockpit treats paused as quiet idle)
 *
 * Plus a synthetic 'content' state that the App.tsx layout decides — fires
 * when an artifact is active so the orb shrinks + slides to upper-left.
 */
export type CockpitState =
  | 'idle'
  | 'wake'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'content';

export function toCockpitState(s: AtlasUIState, hasArtifact: boolean): CockpitState {
  if (hasArtifact && (s === 'idle' || s === 'speaking' || s === 'paused')) {
    return 'content';
  }
  switch (s) {
    case 'idle':
      return 'idle';
    case 'armed':
      return 'wake';
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'paused':
      return 'idle';
  }
}
