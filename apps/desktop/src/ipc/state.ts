/**
 * Thin Tauri IPC wrappers for the Atlas state machine.
 * Rust-side definitions live in `src-tauri/src/commands.rs`.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export async function getState(): Promise<string> {
  return invoke<string>('get_state');
}

export async function setState(value: string): Promise<void> {
  await invoke<void>('set_state', { value });
}

export async function openMainWindow(): Promise<void> {
  await invoke<void>('open_main_window');
}

export async function quitApp(): Promise<void> {
  await invoke<void>('quit_app');
}

export function subscribeToState(
  cb: (next: string) => void,
): Promise<UnlistenFn> {
  return listen<string>('atlas:state', (event) => cb(event.payload));
}
