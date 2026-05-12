# Runbook — ElevenLabs Conversational Agent configuration

Source of truth for the dashboard-side configuration of the Atlas Conversational Agent. The dashboard isn't in git; **this doc is the audit trail**. Any change to the agent's dashboard config gets reflected here in the same commit that motivated it.

The agent's role: receive audio from the desktop (via WebSocket), STT it via Scribe v2 Realtime, route the conversation through Atlas's custom-LLM endpoint (Cloudflare Worker → Claude), TTS the response via Flash v2.5 in the user's chosen IVC voice, and stream audio back.

---

## Two ways to create the agent

### Option A — Dashboard (recommended for first-time setup)

1. Sign in at <https://elevenlabs.io/app/agents>.
2. Click **Create agent** → blank template → name it `Atlas Dev`.
3. Configure each section per the field values in [§ Field-by-field reference](#field-by-field-reference) below.
4. Copy the resulting `agent_id` into `.env.local` as `ATLAS_AGENT_ID`.

### Option B — API (reproducible, scriptable)

```bash
# 1. Generate a Bearer token for the Worker:
TOKEN=$(./scripts/gen-agent-token.sh)
echo "$TOKEN" >> /tmp/atlas-token.txt   # save somewhere safe

# 2. Add the token to the Worker secrets:
cd apps/worker
wrangler secret put ANTHROPIC_API_KEY     # paste your Anthropic key
echo -n "$TOKEN" | wrangler secret put ALLOWED_AGENT_TOKENS
wrangler deploy
# capture the resulting URL, e.g. https://atlas-worker.<sub>.workers.dev

# 3. Add the same token as a workspace secret in ElevenLabs:
#    https://elevenlabs.io/app/conversational-ai/agents → ⚙ Workspace → Secrets → Add Secret
#    name: ATLAS_WORKER_BEARER
#    value: <paste $TOKEN>
#    or via API:
#    curl -X POST https://api.elevenlabs.io/v1/convai/secrets \
#      -H "xi-api-key: $ELEVENLABS_API_KEY" \
#      -H "Content-Type: application/json" \
#      -d "{\"name\":\"ATLAS_WORKER_BEARER\",\"value\":\"$TOKEN\"}"

# 4. Create the agent:
export ELEVENLABS_API_KEY=...
export ATLAS_WORKER_URL=https://atlas-worker.<sub>.workers.dev
export ATLAS_AGENT_TOKEN=$TOKEN
./scripts/create-agent.sh
# → prints agent_id; save it to .env.local as ATLAS_AGENT_ID
```

The payload sent by `create-agent.sh` is generated from `packages/prompts/agent_config_v1.json` (the reference shape) plus the live `packages/prompts/system_v1.md` body. To preview before sending: `./scripts/create-agent.sh --dry-run`.

---

## Field-by-field reference

These values are what the dashboard should show after configuration. If your agent diverges, update this runbook in the same PR.

### Agent → Behaviour

| Field | Value | Why |
|---|---|---|
| **First message** | `Hey {{user_name}} — what's up?` | See `packages/prompts/first_message_v1.md`. Under 8 words; assistant doesn't introduce its name (user picked the voice). |
| **System prompt** | full body of `packages/prompts/system_v1.md` (everything after the first `---`) | Frozen as `system_v1`; bump to `system_v2.md` for any change |
| **Language** | `English` (auto-detect enabled at conversation level) | Multilingual ASR via Scribe v2; Claude responds in user's language |

### Agent → LLM

| Field | Value | Why |
|---|---|---|
| **Model** | **Custom LLM** | We need control over Claude routing, prompt caching, tool result formatting |
| **Server URL** | `https://atlas-worker.<sub>.workers.dev/v1` | The Worker exposes `/v1/chat/completions`; ElevenLabs appends the path |
| **Model ID** | `atlas/default` (or any `claude-*` id to bypass routing) | Routed by `apps/worker/src/claude/router.ts` |
| **API key** | Workspace secret **ATLAS_WORKER_BEARER** | Same value as one entry in the Worker's `ALLOWED_AGENT_TOKENS` |
| **Temperature** | `0.6` | Slight nudge below default; keeps replies natural without hallucinating |
| **Max tokens** | `-1` (unlimited; Worker enforces via `max_tokens` default 2048) | The Worker caps |
| **Tools** | empty in Phase 0.B | Tools land in Phase 1 (registered via `packages/contracts/src/tools/`) |
| **Knowledge base** | empty | Not needed; semantic memory lives in Atlas's local LanceDB (Phase 5) |
| **RAG** | disabled | Same reason |

### Agent → Voice (TTS)

| Field | Value | Why |
|---|---|---|
| **Voice** | dev default: `pNInz6obpgDQGcFmaJgB` (Adam) — see ADR 0016. Per-user, the IVC `voice_id` from onboarding overrides at conversation start. | |
| **Model** | `eleven_flash_v2_5` | Sub-300ms TTFA per dev plan latency budget |
| **Stability** | `0.5` | Balanced; bias toward expressivity per voice-design best practices |
| **Similarity boost** | `0.85` | High clarity on IVC voices |
| **Speed** | `1.0` | Configurable via Phase 17.7 audio-description / cognitive-load modes |

### Agent → ASR (STT)

| Field | Value | Why |
|---|---|---|
| **Provider** | `elevenlabs` (Scribe v2 Realtime) | 150ms STT, multilingual, atypical-speech-friendly |
| **User input audio format** | `pcm_16000` | What `cpal` captures on the desktop |
| **Keywords / phrase bias** | `Atlas` (extend in Phase 5.5 with user-specific terms) | Helps Scribe correctly hear the wake-word echo and rare names |

### Conversation flow (Advanced tab)

| Field | Value | Why |
|---|---|---|
| **Turn timeout** | `10s` | Comfortable for desktop pauses; longer than customer-service defaults |
| **Silence end-call timeout** | `-1` (disabled) | We never auto-end the conversation; user controls |
| **Turn mode** | `turn` (server-side VAD) | Cleanest cross-platform behavior |
| **Turn eagerness** | `normal` | Per build plan; tune to `patient` in cognitive-load modes (Phase 17.6) |
| **Max duration** | `1800s` (30 min) | Re-enter is cheap; capping keeps cost-per-session bounded |
| **Soft timeout** | enabled, `3.0s`, `"Mhm — give me a sec."` | Filler before Claude returns first token; rarely fires given Flash + Claude latency |
| **Interruption** | enabled | Critical for voice-first UX; configured as a client_event |

### Client events (Advanced tab → Client Events)

Enable: `audio`, `interruption`, `user_transcript`, `agent_response`, `agent_response_correction`, `agent_response_metadata`, `client_tool_call`, `agent_tool_response`, `vad_score`.

The desktop (Phase 0.E) consumes these to drive the UI state machine (idle / listening / thinking / speaking) and to dispatch client tools.

### Platform / privacy

| Field | Value | Why |
|---|---|---|
| **Auth required** | off in dev; **on** before any public access | Use signed-URL flow once Phase 0.E lands |
| **Record voice** | on during beta | For debugging real failures; flipped off before public launch |
| **Retention** | 7 days during beta; 0 days at V3 | Privacy moat |
| **Daily call limit** | `5000` agent-wide | Soft guardrail; Worker enforces cost cap separately |

---

## Verifying the setup

After the agent is created, verify in this order — the order matters because each step depends on the previous.

```bash
# 1. Worker /healthz responds
curl -fsS "$ATLAS_WORKER_URL/healthz"

# 2. Full smoke (auth + streaming + Claude round-trip)
ATLAS_WORKER_URL=... ATLAS_AGENT_TOKEN=... ./scripts/test-worker.sh

# 3. Dashboard "Test AI Agent" button — speaks live with the agent
#    Watch the dashboard request log for the custom-LLM POST hitting your Worker.
```

Capture latency baselines on a quiet network: STT first-partial, Claude first-token, Flash TTFA, end-to-end. Log them to `docs/retros/phase-0.md`.

---

## Rotating the Bearer token (zero downtime)

`ALLOWED_AGENT_TOKENS` is comma-separated. To rotate:

```bash
NEW=$(./scripts/gen-agent-token.sh)
OLD=$(wrangler secret get ALLOWED_AGENT_TOKENS)
echo -n "$NEW,$OLD" | wrangler secret put ALLOWED_AGENT_TOKENS

# Update ElevenLabs workspace secret to NEW (dashboard → Workspace → Secrets)
# Watch dashboard for 24 hours to ensure new token works

# Drop OLD:
echo -n "$NEW" | wrangler secret put ALLOWED_AGENT_TOKENS
```

Audit-log the rotation in `~/.local/share/atlas/logs/` (Phase 19.4 makes this voice-queryable).

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard "Test AI Agent" → silence | Worker not deployed, or wrong URL | Check `wrangler deployments list`; confirm URL ends in `/v1` |
| 401 in Worker logs | Bearer mismatch | Workspace secret value ≠ any entry in `ALLOWED_AGENT_TOKENS` |
| 400 schema error in Worker logs | ElevenLabs upgraded a request field unexpectedly | Inspect the body in Worker logs (Cloudflare dashboard → Worker → Tail); extend `OpenAIChatRequest` schema in `apps/worker/src/types/openai.ts` |
| First-token latency > 2s | Claude cache miss on first turn (expected) | Subsequent turns should be < 500ms. Verify `cache_control: ephemeral` on system + last tool in Worker logs |
| Garbled TTS on rare words | Voice cloning sample was noisy | Re-run IVC onboarding (Phase 0.F) with a cleaner sample |
| Agent talks over user | `interruption` client event not enabled | Toggle it on in Advanced tab |
| Agent goes silent mid-turn | Custom-LLM stream errored partway through | Worker logs show the upstream Anthropic error; common: rate limit, token limit, or content policy |

---

## What lives where

| Concern | Source of truth |
|---|---|
| System prompt content | `packages/prompts/system_v1.md` |
| First message | `packages/prompts/first_message_v1.md` |
| Tool schemas | `packages/prompts/tools_v1.json` (generated; phase 1 onward) |
| Agent body for API | `packages/prompts/agent_config_v1.json` |
| Field values the dashboard shows | this runbook |
| Live agent_id | `.env.local` → `ATLAS_AGENT_ID` (per-developer) |
| Worker auth tokens | OS keychain / 1Password / wrangler secrets |
