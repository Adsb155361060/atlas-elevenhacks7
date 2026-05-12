import { create } from 'zustand';

/**
 * Top-level navigation state once the user has completed onboarding.
 * `home` is the conversational surface; `settings` is the configuration UI.
 * Onboarding is handled in a separate store (`state/onboarding.ts`) because
 * it gates access to either of these views.
 */
export type AtlasView = 'home' | 'settings';

interface ViewStore {
  view: AtlasView;
  setView: (v: AtlasView) => void;
  /** Convenience: which section of Settings is active (when view='settings'). */
  settingsSection: SettingsSection;
  setSettingsSection: (s: SettingsSection) => void;
}

export type SettingsSection = 'voice' | 'wake' | 'privacy' | 'about';

export const useView = create<ViewStore>((set) => ({
  view: 'home',
  setView: (v) => set({ view: v }),
  settingsSection: 'voice',
  setSettingsSection: (s) => set({ settingsSection: s }),
}));
