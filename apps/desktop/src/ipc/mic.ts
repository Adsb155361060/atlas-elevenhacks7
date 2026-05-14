import { invoke } from '@tauri-apps/api/core';

export type MicPermissionResult =
  | { ok: true }
  | { ok: false; reason: string; denied: boolean };

/**
 * Ask the OS for microphone access via the WebView's getUserMedia path.
 *
 * On Windows 11 + WebView2, this is the only reliable way to surface the
 * "Allow this app to access your microphone" system prompt to the user.
 * On macOS, it triggers the TCC dialog the first time.
 *
 * We release the captured stream immediately — we only want the side
 * effect (the permission grant), not to hold the device.  cpal in the
 * Rust voice-loop will reopen it per session.
 */
export async function requestMicrophonePermission(): Promise<MicPermissionResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'WebView does not expose getUserMedia', denied: false };
  }

  // The probe is only meaningful on platforms that gate mic access per-app:
  //   • Windows — "Let desktop apps access your microphone" Settings toggle
  //   • macOS   — TCC / NSMicrophoneUsageDescription system prompt
  // On Linux the mic is opened directly by cpal through ALSA/PulseAudio and
  // there's no per-app gate; getUserMedia inside the embedded WebKit2GTK
  // webview reliably returns NotAllowedError even when the OS-level mic is
  // perfectly accessible to the binary. Skip the probe there.
  const ua = navigator.userAgent ?? '';
  const needsProbe = /Macintosh|Mac OS X/.test(ua) || /Windows/.test(ua);
  if (!needsProbe) {
    return { ok: true };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (err) {
    const e = err as DOMException & { message?: string };
    const denied =
      e?.name === 'NotAllowedError' ||
      e?.name === 'SecurityError' ||
      e?.name === 'PermissionDeniedError';
    const reason = e?.message || e?.name || String(err);
    return { ok: false, reason, denied };
  }
}

/**
 * Open the OS mic-privacy settings page. On Windows that's
 * `ms-settings:privacy-microphone`; on macOS, the Privacy → Microphone pane.
 * Resolves to true when the call succeeded.
 */
export async function openMicSettings(): Promise<boolean> {
  try {
    await invoke<void>('open_mic_settings');
    return true;
  } catch {
    return false;
  }
}
