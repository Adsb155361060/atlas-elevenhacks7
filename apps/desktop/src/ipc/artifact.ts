import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ArtifactKind } from '../state/artifact';

/** Shape the Rust side emits — see `src-tauri/src/tools/render_artifact.rs`. */
export interface ArtifactEventPayload {
  kind: ArtifactKind | string;
  data: unknown;
  narration?: string;
  received_at: number;
  id?: string;
}

export async function subscribeToArtifacts(
  cb: (event: ArtifactEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<ArtifactEventPayload>('atlas:artifact', (e) => cb(e.payload));
}
