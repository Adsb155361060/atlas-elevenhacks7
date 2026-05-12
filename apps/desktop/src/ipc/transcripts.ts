import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type TranscriptRole = 'user' | 'agent';

export interface TranscriptEvent {
  role: TranscriptRole;
  text: string;
  correctedFrom?: string;
}

/**
 * Subscribe to user + agent transcripts and the agent-correction event
 * (truncation after interruption). Returns an async unlisten function.
 */
export async function subscribeToTranscripts(
  cb: (event: TranscriptEvent) => void,
): Promise<UnlistenFn> {
  const userUnlisten = await listen<string>('atlas:transcript:user', (e) =>
    cb({ role: 'user', text: e.payload }),
  );
  const agentUnlisten = await listen<string>('atlas:transcript:agent', (e) =>
    cb({ role: 'agent', text: e.payload }),
  );
  const correctedUnlisten = await listen<string>(
    'atlas:transcript:agent_corrected',
    (e) => cb({ role: 'agent', text: e.payload, correctedFrom: 'previous' }),
  );

  return () => {
    userUnlisten();
    agentUnlisten();
    correctedUnlisten();
  };
}
