import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface CallEvent {
  tool_name: string;
  tool_call_id: string;
}

interface ResultEvent {
  tool_name: string;
  tool_call_id: string;
  is_error: boolean;
  error_message: string;
}

export async function subscribeToToolStatus(
  onCall: (e: CallEvent) => void,
  onResult: (e: ResultEvent) => void,
): Promise<UnlistenFn> {
  const u1 = await listen<CallEvent>('voice:client_tool_call', (e) => onCall(e.payload));
  const u2 = await listen<ResultEvent>('voice:client_tool_result', (e) => onResult(e.payload));
  return () => {
    u1();
    u2();
  };
}
