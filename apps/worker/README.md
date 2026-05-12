# `@atlas/worker` — Cloudflare Worker (Claude proxy for ElevenLabs Conversational Agent)

ElevenLabs Conversational Agent's "custom LLM" feature expects an OpenAI-compatible Chat Completions endpoint. This Worker is that endpoint — it translates OpenAI-shape requests to Anthropic's Messages API, streams Claude's response back in OpenAI Server-Sent Events format, and adds Atlas-specific concerns (auth via shared secret, prompt caching on system + tools blocks, tiered model routing, cost guardrails).

## What it does

```
ElevenLabs Conversational Agent
   │
   │  POST /v1/chat/completions   (OpenAI-shape, stream:true, includes tools[])
   ▼
@atlas/worker  (this package)
   │  • verify Bearer token (ALLOWED_AGENT_TOKENS)
   │  • translate OpenAI request → Anthropic Messages API
   │  • mark system + tools blocks with cache_control: ephemeral
   │  • route to claude-opus-4-7 / sonnet-4-6 / haiku-4-5 by model arg
   │  ▼
   │  Anthropic API (@anthropic-ai/sdk streaming)
   │  ▲
   │  • re-stream Anthropic events back as OpenAI SSE chunks
   │  • map text deltas + tool_use blocks to OpenAI delta shape
   ▼
ElevenLabs (TTS via Flash v2.5 → audio over WS)
```

## Endpoints

- `GET /healthz` — liveness probe.
- `POST /v1/chat/completions` — the main path. OpenAI-compatible; streams.

## Auth

A shared secret is presented by ElevenLabs on every call via the `Authorization: Bearer ...` header. Configure `ALLOWED_AGENT_TOKENS` (comma-separated for zero-downtime rotation) via `wrangler secret put`.

## Dev

```bash
pnpm install
cp ../../.env.example ../../.env.local  # fill in keys
wrangler dev                            # local Worker at :8787

# Smoke test (text-only, no tools)
curl -N \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7","stream":true,"messages":[{"role":"user","content":"say hi in 5 words"}]}' \
  http://localhost:8787/v1/chat/completions
```

## Deploy

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ALLOWED_AGENT_TOKENS
# ... other secrets per .env.example
wrangler deploy
```

The deployed URL goes into the ElevenLabs Conversational Agent's "custom LLM endpoint" field (per `docs/runbooks/agent-config.md`).

## Test

```bash
pnpm test            # vitest
pnpm typecheck       # tsc --noEmit
pnpm deploy:dry      # wrangler dry-run
```

## Why we don't just use the Anthropic SDK's OpenAI compatibility shim

The SDK ships a shim that exposes an OpenAI-compatible interface on the *client* side. We need the inverse — an *endpoint* that receives OpenAI requests and translates outward to Anthropic. The shapes overlap but the streaming wiring + Atlas-specific concerns (auth, routing, caching, eventual cost guardrails, tool-result post-processing) make it cleaner to own.
