# Runbook — ElevenLabs Conversational Agent configuration

Source of truth for the dashboard-side config of the Atlas Conversational Agent. (The dashboard isn't in git; this doc is the audit trail.)

## When this runbook applies

Any change to the agent's dashboard config — custom LLM endpoint, system prompt, voice, tools, VAD settings, interruption handling.

## Procedure (filled at Phase 0.B)

To be written. Stub.

## Settings to capture for the audit trail

- Agent ID
- LLM endpoint URL
- Auth header secret reference (which `ALLOWED_AGENT_TOKENS` entry)
- System prompt version (`packages/prompts/system_v{N}.md`)
- TTS voice ID (default + per-user override mechanism)
- STT model
- VAD settings
- Interruption settings
- Tool list (point to `packages/prompts/tools_v{N}.json`)
