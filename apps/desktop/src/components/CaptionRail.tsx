/**
 * Caption rail — bottom-left transcript surface. Replaces the old
 * CaptionStrip's full-width slab with a tighter, left-anchored block in
 * the brass-and-ink design language.
 *
 * One of four state modes:
 *   idle / wake → ambient invitation ("Say 'Hey Atlas' or tap anywhere")
 *   listening   → eyebrow "HEARING YOU" + the live user transcript
 *   thinking    → eyebrow + italicised "consulting sources..."
 *   speaking    → eyebrow "SPEAKING" + the agent's reply
 *   content     → compact eyebrow naming the artifact + "say 'next' or 'close'"
 *
 * Reads from the same useTranscripts store as before; the difference is
 * presentation, not data flow.
 */

import { useEffect, useRef } from 'react';
import { useTranscripts, type TranscriptEntry } from '../state/transcripts';
import type { CockpitState } from '../state/cockpit';
import type { Artifact } from '../state/artifact';

const CAPTION_CSS = `
  .caption-rail {
    position: absolute;
    left: 48px;
    bottom: 140px;
    max-width: 720px;
    pointer-events: none;
    z-index: 10;
  }
  .caption-rail.compact { bottom: 132px; }
  .caption-rail.mute .cap-eyebrow { color: var(--cream-faint); }
  .cap-eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--cream-mute);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cap-eyebrow .brass { color: var(--brass); }
  .cap-eyebrow .dot {
    width: 6px; height: 6px; border-radius: 999px;
    background: var(--cream-mute);
    display: inline-block;
  }
  .cap-eyebrow .dot.brass { background: var(--brass); }
  .cap-eyebrow .dot.pulse {
    background: var(--brass);
    animation: caption-pulse 1.4s ease-in-out infinite;
  }
  @keyframes caption-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.35; transform: scale(0.75); }
  }
  .cap-text {
    font-family: var(--font-serif);
    font-weight: 300;
    font-size: 32px;
    line-height: 1.25;
    color: var(--cream);
    letter-spacing: -0.005em;
    text-wrap: balance;
    font-variation-settings: "opsz" 60, "SOFT" 30;
  }
  .cap-text.muted {
    color: var(--cream-mute);
    font-style: italic;
  }
`;

interface CaptionRailProps {
  state: CockpitState;
  wakeWord: string;
  artifact: Artifact | null;
}

export function CaptionRail({ state, wakeWord, artifact }: CaptionRailProps) {
  const entries = useTranscripts((s) => s.entries);
  const lastUserRef = useRef<TranscriptEntry | null>(null);
  const lastAgentRef = useRef<TranscriptEntry | null>(null);

  useEffect(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.role === 'user' && !lastUserRef.current) lastUserRef.current = e;
      if (e.role === 'agent' && !lastAgentRef.current) lastAgentRef.current = e;
      if (lastUserRef.current && lastAgentRef.current) break;
    }
    // Reset trackers whenever the entries set shrinks (clear on session end).
    if (entries.length === 0) {
      lastUserRef.current = null;
      lastAgentRef.current = null;
    }
  }, [entries]);

  // Reach back through `entries` each render for the freshest values per
  // role; mutable refs above are only used to ensure we re-read on changes.
  const latestUser = [...entries].reverse().find((e) => e.role === 'user');
  const latestAgent = [...entries].reverse().find((e) => e.role === 'agent');

  return (
    <>
      <style>{CAPTION_CSS}</style>
      {renderBody(state, wakeWord, artifact, latestUser, latestAgent)}
    </>
  );
}

function renderBody(
  state: CockpitState,
  wakeWord: string,
  artifact: Artifact | null,
  latestUser: TranscriptEntry | undefined,
  latestAgent: TranscriptEntry | undefined,
): JSX.Element {
  if (state === 'idle' || state === 'wake') {
    return (
      <div className="caption-rail mute" aria-live="polite">
        <div className="cap-eyebrow">
          <span className="dot" />
          AMBIENT&nbsp;·&nbsp;SAY <span className="brass">&ldquo;{wakeWord}&rdquo;</span> OR
          PRESS&nbsp;<span className="brass">⌘&thinsp;+&thinsp;⇧&thinsp;+&thinsp;A</span>
        </div>
      </div>
    );
  }
  if (state === 'listening') {
    return (
      <div className="caption-rail" aria-live="polite">
        <div className="cap-eyebrow">
          <span className="dot pulse" />
          HEARING YOU
        </div>
        {latestUser ? (
          <div className="cap-text">&ldquo;{latestUser.text}&rdquo;</div>
        ) : (
          <div className="cap-text muted">listening…</div>
        )}
      </div>
    );
  }
  if (state === 'thinking') {
    return (
      <div className="caption-rail" aria-live="polite">
        <div className="cap-eyebrow">
          <span className="dot pulse" />
          WORKING IT THROUGH
        </div>
        <div className="cap-text muted">consulting sources…</div>
      </div>
    );
  }
  if (state === 'speaking') {
    return (
      <div className="caption-rail" aria-live="polite">
        <div className="cap-eyebrow">
          <span className="dot brass" />
          SPEAKING
        </div>
        {latestAgent ? (
          <div className="cap-text">{latestAgent.text}</div>
        ) : (
          <div className="cap-text muted">…</div>
        )}
      </div>
    );
  }
  // content
  const panel = artifact?.kind?.toUpperCase() ?? 'ARTIFACT';
  return (
    <div className="caption-rail compact" aria-live="polite">
      <div className="cap-eyebrow">
        <span className="dot brass" />
        ON SCREEN&nbsp;·&nbsp;<span className="brass">{panel}</span>
        &nbsp;·&nbsp;
        SAY <span className="brass">&ldquo;next&rdquo;</span> OR{' '}
        <span className="brass">&ldquo;close&rdquo;</span>
      </div>
    </div>
  );
}
