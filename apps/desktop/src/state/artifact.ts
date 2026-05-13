import { create } from 'zustand';

/**
 * Live artifact store. `render_artifact` events from the agent arrive via
 * the `atlas:artifact` Tauri event (emitted by `src-tauri/src/tools/
 * render_artifact.rs`). We keep the **current** artifact for display plus a
 * short history so the user can scroll back through this session's renders.
 *
 * Version semantics: when an agent iterates ("now in blue"), it re-sends an
 * artifact with the same `id` and a higher `version`. The surface animates
 * between versions instead of remounting the renderer.
 */

export type ArtifactKind =
  | 'map'
  | 'chart'
  | 'code'
  | 'markdown'
  | 'image'
  | 'audio'
  | 'table'
  | 'search_results'
  | 'tutorial';

export interface Artifact {
  kind: ArtifactKind;
  data: unknown;
  narration?: string;
  /** Optional caller-supplied id for cross-turn iteration. Generated client-side if omitted. */
  id: string;
  /** Bumped on each render; 1 for first send under a given id. */
  version: number;
  /** Epoch-ms when the desktop received this. */
  received_at: number;
}

interface ArtifactStore {
  current: Artifact | null;
  /** Most-recent first. Capped at MAX_HISTORY. */
  history: Artifact[];
  /** Ingest a raw event from `atlas:artifact`. */
  ingest: (raw: {
    kind: ArtifactKind | string;
    data: unknown;
    narration?: string;
    received_at?: number;
    id?: string;
  }) => void;
  clear: () => void;
}

const MAX_HISTORY = 12;
let monotonic = 1;

export const useArtifact = create<ArtifactStore>((set, get) => ({
  current: null,
  history: [],
  ingest: (raw) => {
    const id = raw.id ?? `local-${monotonic++}`;
    const existing = get().history.find((h) => h.id === id);
    const version = existing ? existing.version + 1 : 1;
    const artifact: Artifact = {
      kind: raw.kind as ArtifactKind,
      data: raw.data,
      ...(raw.narration !== undefined ? { narration: raw.narration } : {}),
      id,
      version,
      received_at: raw.received_at ?? Date.now(),
    };
    set((state) => {
      const next = state.history.filter((h) => h.id !== id);
      next.unshift(artifact);
      while (next.length > MAX_HISTORY) next.pop();
      return { current: artifact, history: next };
    });
  },
  clear: () => set({ current: null, history: [] }),
}));
