# `packages/prompts`

Versioned system prompts and tool-schema bundles consumed by the Conversational Agent and Claude.

## Conventions

- `system_v{N}.md` — frozen once shipped. Bump N for any change.
- `tools_v{N}.json` — generated from `packages/contracts/src/tools/` via `pnpm gen:tools`. Do not edit by hand.
- Eval changes that depend on a prompt version live in `apps/worker/src/eval/cases-v{N}.jsonl`.

## Status

Empty. Filled at Phase 0.B (system_v1.md) and Phase 1 onward (tools_v1.json).
