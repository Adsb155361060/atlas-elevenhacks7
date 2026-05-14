import { invoke } from '@tauri-apps/api/core';

/**
 * Fetch the tail of the app log file and copy it to the system clipboard,
 * preceded by a small header carrying the current state + last transcript
 * pair so a single paste is self-contained.
 *
 * Returns the number of bytes copied (for the success toast).
 */
export async function copyDiagnosticsToClipboard(header: {
  state: string;
  lastUser?: string;
  lastAgent?: string;
}): Promise<number> {
  const tail = await invoke<string>('copy_diagnostics', { lines: 120 });
  const ts = new Date().toISOString();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a';
  const banner = [
    '======== ATLAS DIAGNOSTICS ========',
    `timestamp: ${ts}`,
    `state:     ${header.state}`,
    `userAgent: ${ua}`,
    header.lastUser ? `last user: ${header.lastUser}` : null,
    header.lastAgent ? `last agent: ${header.lastAgent}` : null,
    '------- log tail (latest first cut at top) -------',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  const payload = banner + tail + '\n=================================\n';
  await navigator.clipboard.writeText(payload);
  return payload.length;
}
