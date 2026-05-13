import { create } from 'zustand';

export interface InflightTool {
  tool_name: string;
  tool_call_id: string;
  started_at: number;
}

interface ToolStatusStore {
  inflight: InflightTool[];
  /** A short-lived error message + tool name shown via ErrorToast. */
  lastError: { tool_name: string; message: string; ts: number } | null;
  startCall: (call: { tool_name: string; tool_call_id: string }) => void;
  endCall: (call: { tool_call_id: string; is_error: boolean; error_message?: string; tool_name: string }) => void;
  dismissError: () => void;
}

export const useToolStatus = create<ToolStatusStore>((set) => ({
  inflight: [],
  lastError: null,
  startCall: ({ tool_name, tool_call_id }) =>
    set((s) => ({
      inflight: [
        ...s.inflight.filter((t) => t.tool_call_id !== tool_call_id),
        { tool_name, tool_call_id, started_at: Date.now() },
      ],
    })),
  endCall: ({ tool_call_id, is_error, error_message, tool_name }) =>
    set((s) => ({
      inflight: s.inflight.filter((t) => t.tool_call_id !== tool_call_id),
      lastError:
        is_error && error_message
          ? { tool_name, message: error_message, ts: Date.now() }
          : s.lastError,
    })),
  dismissError: () => set({ lastError: null }),
}));
