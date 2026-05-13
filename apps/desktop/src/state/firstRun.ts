import { create } from 'zustand';

interface FirstRunStore {
  /** null while loading from prefs; true after the tutorial has been dismissed. */
  dismissed: boolean | null;
  setDismissed: (v: boolean) => void;
}

export const useFirstRun = create<FirstRunStore>((set) => ({
  dismissed: null,
  setDismissed: (v) => set({ dismissed: v }),
}));
