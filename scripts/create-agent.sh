#!/usr/bin/env bash
# Create the Atlas Conversational Agent via the ElevenLabs API.
# Alternative to clicking through the dashboard. Useful for reproducibility +
# environment-specific agents (dev / staging / prod).
#
# Reads:
#   ELEVENLABS_API_KEY    — required, from env (1Password / direnv / .env.local)
#   ATLAS_WORKER_URL      — required, the deployed Worker base URL
#                           (e.g. https://atlas-worker.<sub>.workers.dev)
#   ATLAS_AGENT_TOKEN     — required, one of ALLOWED_AGENT_TOKENS
#   ATLAS_AGENT_NAME      — optional, defaults to "Atlas Dev"
#   PROMPT_FILE           — optional, defaults to packages/prompts/system_v1.md
#   CONFIG_FILE           — optional, defaults to packages/prompts/agent_config_v1.json
#
# IMPORTANT: this script does **two** things you cannot do via dashboard alone:
#   1. Adds the Worker secret to your ElevenLabs workspace (so it's
#      selectable as the custom-LLM auth) — handled out of band by the user;
#      we just print the cURL once it's set.
#   2. Creates the agent with the custom-LLM URL + secret reference wired up.
#
# Usage:
#   ./scripts/create-agent.sh                      # creates agent, prints agent_id
#   ./scripts/create-agent.sh --dry-run            # prints the payload, doesn't POST

set -euo pipefail

C_RED='\033[0;31m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_NC='\033[0m'
ok()    { printf "${C_GREEN}✓${C_NC} %s\n" "$1"; }
warn()  { printf "${C_YELLOW}⚠${C_NC} %s\n" "$1"; }
fail()  { printf "${C_RED}✗${C_NC} %s\n" "$1" >&2; exit 1; }

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

: "${ELEVENLABS_API_KEY:?must set ELEVENLABS_API_KEY}"
: "${ATLAS_WORKER_URL:?must set ATLAS_WORKER_URL}"
: "${ATLAS_AGENT_TOKEN:?must set ATLAS_AGENT_TOKEN (one of ALLOWED_AGENT_TOKENS)}"

ATLAS_AGENT_NAME="${ATLAS_AGENT_NAME:-Atlas Dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT_FILE="${PROMPT_FILE:-$ROOT/packages/prompts/system_v1.md}"
CONFIG_FILE="${CONFIG_FILE:-$ROOT/packages/prompts/agent_config_v1.json}"
[[ -f "$PROMPT_FILE" ]] || fail "missing prompt file: $PROMPT_FILE"
[[ -f "$CONFIG_FILE" ]] || fail "missing config file: $CONFIG_FILE"

command -v jq >/dev/null 2>&1 || fail "jq is required (sudo apt install jq)"

# Strip the markdown header (everything up to and including the first `---`)
# so the agent sees only the prompt body. If no `---` separator is found,
# fall back to the entire file.
prompt_body=$(awk '
  /^---[[:space:]]*$/ && !past { past = 1; next }
  past { print }
' "$PROMPT_FILE")
if [[ -z "$prompt_body" ]]; then
  prompt_body=$(cat "$PROMPT_FILE")
fi

# Build the request payload: strip $comment* keys from the reference config, then
# inject prompt body, worker URL, and auth secret into the agent.prompt object.
payload=$(jq \
  --arg prompt "$prompt_body" \
  --arg url "${ATLAS_WORKER_URL%/}/v1" \
  --arg name "$ATLAS_AGENT_NAME" \
  --arg model "atlas/default" \
  '
  walk(
    if type == "object" then
      with_entries(select(.key | startswith("$comment") | not))
    else . end
  )
  | .name = $name
  | .conversation_config.agent.prompt.prompt = $prompt
  | .conversation_config.agent.prompt.custom_llm = {
      "url": $url,
      "model_id": $model,
      "api_key": { "secret_id": "ATLAS_WORKER_BEARER" },
      "request_headers": {}
    }
  ' "$CONFIG_FILE")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "$payload" | jq .
  exit 0
fi

warn "Before this script will work end-to-end, ensure the ElevenLabs workspace"
warn "secret 'ATLAS_WORKER_BEARER' contains the Bearer token shared with the Worker."
warn "Create it at: https://elevenlabs.io/app/conversational-ai/agents → Workspace → Secrets"
warn "Or via API: POST /v1/convai/secrets {name:'ATLAS_WORKER_BEARER', value:'<token>'}"
warn ""

response=$(curl -fsS -X POST 'https://api.elevenlabs.io/v1/convai/agents/create' \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data "$payload")

agent_id=$(echo "$response" | jq -r '.agent_id // empty')
if [[ -z "$agent_id" ]]; then
  fail "agent create failed; response: $response"
fi

ok "agent created: $agent_id"
echo
echo "Next:"
echo "  1. Add to your .env.local:"
echo "       ATLAS_AGENT_ID=$agent_id"
echo "  2. Smoke from the dashboard 'Test AI Agent' button, or via:"
echo "       ./scripts/test-worker.sh"
echo "  3. Snapshot the dashboard config into docs/runbooks/agent-config.md."
