# 0010 — LLM router: Opus 4.7 default, Sonnet 4.6 for tool routing, Haiku 4.5 for triage

- Date: 2026-05-12
- Status: Accepted

## Context

Claude Opus 4.7 is the strongest model and the right default for the reasoning brain. But every voice turn runs at conversational latency, and Opus is the most expensive. Two cost levers: route simpler tasks to Sonnet/Haiku, and aggressively use prompt caching on the static system + tools blocks.

Per build plan §17.4 and dev plan §22.4: tiered routing with explicit per-tool rules.

## Decision

- Default model for tool-using conversational turns: **Claude Opus 4.7** (`claude-opus-4-7`).
- Tool-call routing / simple-classification turns: **Claude Sonnet 4.6** (`claude-sonnet-4-6`).
- High-throughput background classifiers (notification triage, email triage, daily-summary batch): **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`).
- Prompt caching always-on for system prompt + tools block.
- Override per request via `model` field in OpenAI-shape body (so eval scripts can pin a model).

## Consequences

- ~60% cost reduction vs Opus-only baseline at typical V1 mix.
- Some quality regression possible on Sonnet/Haiku tasks; eval suite catches it.
- Per-tool routing rules need to be maintained; pile of small decisions.

## Recovery

If a quality regression surfaces on a Sonnet/Haiku route, flip back to Opus for that route via the routing config in `apps/worker/src/claude/router.ts`. Single-line change.
