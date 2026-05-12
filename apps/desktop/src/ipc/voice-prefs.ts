import { invoke } from '@tauri-apps/api/core';

export type VoiceSource = 'stock' | 'cloned_record' | 'cloned_upload';

export interface VoicePreferences {
  voice_id: string | null;
  voice_name: string | null;
  voice_source: string | null;
  onboarding_completed: boolean;
}

export interface CloneResult {
  voice_id: string;
  requires_verification: boolean;
}

/**
 * Loose envelope around the raw ElevenLabs voice list. We don't model the
 * upstream schema rigorously — it evolves.
 */
export interface StockVoice {
  voice_id: string;
  name: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
}

export interface StockVoiceList {
  raw: {
    voices?: StockVoice[];
    [key: string]: unknown;
  };
}

export async function getPrefs(): Promise<VoicePreferences> {
  return invoke<VoicePreferences>('voice_prefs_get');
}

export async function setPrefs(
  voice_id: string,
  voice_name: string,
  source: VoiceSource,
): Promise<void> {
  await invoke<void>('voice_prefs_set', { voiceId: voice_id, voiceName: voice_name, source });
}

export async function resetPrefs(): Promise<void> {
  await invoke<void>('voice_prefs_reset');
}

export async function completeOnboarding(): Promise<void> {
  await invoke<void>('voice_onboarding_complete');
}

export async function listStockVoices(query?: string): Promise<StockVoiceList> {
  return invoke<StockVoiceList>('voice_list_stock', { query });
}

export async function recordAndClone(
  seconds: number,
  voice_name: string,
): Promise<CloneResult> {
  return invoke<CloneResult>('voice_record_and_clone', {
    seconds,
    voiceName: voice_name,
  });
}

export async function uploadAndClone(
  bytes: number[] | Uint8Array,
  filename: string,
  voice_name: string,
): Promise<CloneResult> {
  // Tauri's JSON IPC needs a plain array for Vec<u8> on the Rust side.
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  return invoke<CloneResult>('voice_upload_and_clone', {
    bytes: arr,
    filename,
    voiceName: voice_name,
  });
}
