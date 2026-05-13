import { Orb } from './Orb';
import type { CockpitState } from '../state/cockpit';
import type { AudioLevel } from '../state/audio';

/**
 * OrbStage — positions the orb inside the cockpit:
 *   - Centered + 680×680 when state ≠ 'content'.
 *   - Left-anchored + 260×260 when state === 'content' (so the artifact
 *     surface gets the right ~58% of the window).
 *
 * Transitions between the two layouts use a 900ms eased cubic-bezier
 * matching the reference design.
 */

interface OrbStageProps {
  state: CockpitState;
  audio: AudioLevel;
  reduced?: boolean;
  theme?: 'dark' | 'light';
}

const TRANSITION =
  'transform 900ms cubic-bezier(.32,.72,.21,1), width 900ms cubic-bezier(.32,.72,.21,1), height 900ms cubic-bezier(.32,.72,.21,1), left 900ms cubic-bezier(.32,.72,.21,1), top 900ms cubic-bezier(.32,.72,.21,1)';

export function OrbStage({ state, audio, reduced, theme }: OrbStageProps) {
  const isContent = state === 'content';
  const style: React.CSSProperties = isContent
    ? {
        position: 'absolute',
        width: 260,
        height: 260,
        left: 96,
        top: '50%',
        transform: 'translate(0, -50%)',
        transition: TRANSITION,
        pointerEvents: 'none',
      }
    : {
        position: 'absolute',
        width: 680,
        height: 680,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        transition: TRANSITION,
        pointerEvents: 'none',
      };

  return (
    <div style={style}>
      <Orb state={state} audio={audio} reduced={reduced} theme={theme} />
    </div>
  );
}
