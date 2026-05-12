import { create } from 'zustand';

/**
 * Onboarding wizard state. The flow is intentionally short for Phase 0.F:
 *
 *   welcome → voice-picker → privacy → done
 *
 * Wake-phrase preview, mic/audio device picker, and granular privacy toggles
 * land in Phase 0.G/0.H.
 */
export type OnboardingStep = 'welcome' | 'voice' | 'privacy' | 'done';

const ORDER: OnboardingStep[] = ['welcome', 'voice', 'privacy', 'done'];

interface OnboardingStore {
  /** Has the user completed onboarding (read from Rust prefs on mount)? */
  completed: boolean | null;
  /** Active wizard step. Ignored when `completed` is true. */
  step: OnboardingStep;
  /** Chosen voice — populated after the voice-picker step. */
  pickedVoice: { id: string; name: string; source: string } | null;

  setCompleted: (v: boolean) => void;
  setStep: (s: OnboardingStep) => void;
  next: () => void;
  back: () => void;
  setPickedVoice: (v: { id: string; name: string; source: string } | null) => void;
}

export const useOnboarding = create<OnboardingStore>((set) => ({
  completed: null,
  step: 'welcome',
  pickedVoice: null,
  setCompleted: (v) => set({ completed: v }),
  setStep: (s) => set({ step: s }),
  next: () =>
    set((state) => {
      const i = ORDER.indexOf(state.step);
      const nextStep = i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1]! : state.step;
      return { step: nextStep };
    }),
  back: () =>
    set((state) => {
      const i = ORDER.indexOf(state.step);
      const prevStep = i > 0 ? ORDER[i - 1]! : state.step;
      return { step: prevStep };
    }),
  setPickedVoice: (v) => set({ pickedVoice: v }),
}));
