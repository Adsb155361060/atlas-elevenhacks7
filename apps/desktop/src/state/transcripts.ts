import { create } from 'zustand';
import type { TranscriptEvent } from '../ipc/transcripts';

/**
 * Live caption store. Holds the last ~12 turns of the active session as a
 * scrolling transcript. Cleared between sessions by the `clear()` action,
 * which the orchestrator triggers via the `voice:session_ended` event.
 */

export interface TranscriptEntry {
  /** Monotonic id assigned at insert time; React key. */
  id: number;
  role: 'user' | 'agent';
  text: string;
  /** Wall-clock timestamp (epoch ms) for sort + display. */
  ts: number;
}

interface TranscriptStore {
  entries: TranscriptEntry[];
  /** Append a new transcript line. If `correctedFrom` is set, replace the
   *  most recent agent entry instead of appending (truncation after
   *  interruption). */
  ingest: (event: TranscriptEvent) => void;
  clear: () => void;
}

const MAX_ENTRIES = 12;
let nextId = 1;

export const useTranscripts = create<TranscriptStore>((set) => ({
  entries: [],
  ingest: (event) =>
    set((state) => {
      if (event.correctedFrom !== undefined) {
        // Replace the last agent entry in place.
        let lastAgentIdx = -1;
        for (let i = state.entries.length - 1; i >= 0; i--) {
          if (state.entries[i]?.role === 'agent') {
            lastAgentIdx = i;
            break;
          }
        }
        if (lastAgentIdx >= 0) {
          const next = state.entries.slice();
          const prev = next[lastAgentIdx];
          if (prev) {
            next[lastAgentIdx] = { ...prev, text: event.text, ts: Date.now() };
            return { entries: next };
          }
        }
        // Fallthrough: no prior agent entry to correct — treat as append.
      }
      const entry: TranscriptEntry = {
        id: nextId++,
        role: event.role,
        text: event.text,
        ts: Date.now(),
      };
      const next = state.entries.concat(entry);
      while (next.length > MAX_ENTRIES) next.shift();
      return { entries: next };
    }),
  clear: () => set({ entries: [] }),
}));
