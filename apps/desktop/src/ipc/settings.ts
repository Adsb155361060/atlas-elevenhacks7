import { invoke } from '@tauri-apps/api/core';

export interface AppInfo {
  version: string;
  target_os: string;
  target_arch: string;
  debug: boolean;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info');
}

/**
 * Wipes voice prefs + onboarding flag locally and closes the active voice
 * session if one is live. Surfaces the user back into the onboarding wizard.
 * Does NOT touch remote artifacts (cloned voices on ElevenLabs, conversation
 * history on dashboard) — point the user at those out-of-band.
 */
export async function resetAllData(): Promise<void> {
  await invoke<void>('settings_reset_all_data');
}

export async function toggleMiniWindow(): Promise<void> {
  await invoke<void>('toggle_mini_window');
}
