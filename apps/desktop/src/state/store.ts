import { create } from 'zustand';

/**
 * UI-level conversation state. Mirrors the Rust `AtlasState` enum in
 * src-tauri/src/state.rs. The Rust side is authoritative; the frontend
 * subscribes to the `atlas:state` event and reflects whatever it receives.
 */
export type AtlasUIState =
  | 'idle'
  | 'armed'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'paused';

const UI_STATES: readonly AtlasUIState[] = [
  'idle',
  'armed',
  'listening',
  'thinking',
  'speaking',
  'paused',
];

function asUIState(value: string): AtlasUIState {
  return (UI_STATES as readonly string[]).includes(value)
    ? (value as AtlasUIState)
    : 'idle';
}

interface AtlasStore {
  state: AtlasUIState;
  setState: (s: string) => void;
}

export const useAtlasState = create<AtlasStore>((set) => ({
  state: 'idle',
  setState: (s: string) => set({ state: asUIState(s) }),
}));
