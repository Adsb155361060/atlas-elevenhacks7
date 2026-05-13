import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

interface Prompt {
  label: string;
  text: string;
}

const PROMPTS: Prompt[] = [
  { label: 'Search the web', text: "What's the weather in San Francisco tomorrow?" },
  { label: 'Generate an image', text: 'Generate a watercolour cat astronaut on Mars.' },
  { label: 'Make music', text: 'Make me a 30-second warm lo-fi loop.' },
  { label: 'Look at my screen', text: "What's on my screen right now?" },
  { label: 'Check my calendar', text: "What's on my schedule today?" },
  { label: 'Take a note', text: 'Make a note that I need to call my mom.' },
];

/**
 * Renders below the idle copy when no artifact is active. Each chip is a
 * sample query the user can read out loud. Clicking one fires the agent
 * directly (via the debug `send_user_message_test` command in dev builds;
 * release builds hide the click path and the chips are read-aloud cues).
 */
export function IdlePrompts() {
  const [hint, setHint] = useState<string | null>(null);

  const trigger = async (prompt: Prompt) => {
    try {
      await invoke<void>('send_user_message_test', { text: prompt.text });
      setHint(`Sent: "${prompt.text}"`);
      window.setTimeout(() => setHint(null), 2500);
    } catch {
      // Release build — the debug command is stripped. Show a hint that
      // they should read it aloud instead.
      setHint(`Try saying: "${prompt.text}"`);
      window.setTimeout(() => setHint(null), 4500);
    }
  };

  return (
    <div className="mt-8 max-w-3xl mx-auto">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 text-center mb-3">
        Try saying
      </p>
      <ul className="flex flex-wrap gap-2 justify-center">
        {PROMPTS.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              onClick={() => trigger(p)}
              className="group px-3 py-1.5 rounded-full border border-slate-800 hover:border-emerald-500/60 bg-slate-900/40 hover:bg-slate-900/80 transition-colors"
            >
              <span className="text-xs text-slate-400 group-hover:text-slate-200">
                <span className="text-emerald-400">›</span> {p.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hint ? (
        <p className="mt-4 text-center text-[11px] text-slate-500 animate-fade-in">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
