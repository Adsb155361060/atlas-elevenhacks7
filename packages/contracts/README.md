# `packages/contracts`

Shared TypeScript types and zod schemas used by both `apps/worker` and `apps/desktop` (via codegen for Rust where needed).

Tool schemas live here as the source of truth and are codegen'd into `packages/prompts/tools_v{N}.json` for the agent and into `apps/desktop/src-tauri/src/tools/generated.rs` for the desktop dispatcher.

## Status

Empty. Filled at Phase 1.0.
