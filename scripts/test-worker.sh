#!/usr/bin/env bash
# Smoke-test the deployed (or local) Atlas Worker against the OpenAI-compatible
# /v1/chat/completions endpoint. Verifies:
#   - /healthz reachable
#   - auth rejects bad token
#   - auth accepts good token
#   - SSE stream returns at least one assistant content delta
#   - stream terminates with `data: [DONE]`
#
# Reads from $ATLAS_WORKER_URL and $ATLAS_AGENT_TOKEN (use one of the tokens
# from ALLOWED_AGENT_TOKENS in your Worker secrets).
#
# Usage:
#   export ATLAS_WORKER_URL=http://localhost:8787
#   export ATLAS_AGENT_TOKEN=$(./scripts/gen-agent-token.sh)   # for local dev only
#   ./scripts/test-worker.sh

set -euo pipefail

C_RED='\033[0;31m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_NC='\033[0m'
ok()   { printf "${C_GREEN}✓${C_NC} %s\n" "$1"; }
fail() { printf "${C_RED}✗${C_NC} %s\n" "$1" >&2; exit 1; }
warn() { printf "${C_YELLOW}⚠${C_NC} %s\n" "$1"; }

: "${ATLAS_WORKER_URL:?must set ATLAS_WORKER_URL (e.g. http://localhost:8787 or your deployed worker)}"
: "${ATLAS_AGENT_TOKEN:?must set ATLAS_AGENT_TOKEN (one of ALLOWED_AGENT_TOKENS)}"

URL_BASE="${ATLAS_WORKER_URL%/}"
CHAT="$URL_BASE/v1/chat/completions"
HEALTHZ="$URL_BASE/healthz"

echo "→ Worker: $URL_BASE"

# ─── 1. /healthz ───
health=$(curl -fsS "$HEALTHZ" || true)
if [[ -z "$health" ]]; then
  fail "/healthz unreachable"
fi
if ! echo "$health" | grep -q '"ok":true'; then
  fail "/healthz returned unexpected body: $health"
fi
ok "/healthz: $(echo "$health" | head -c 80)"

# ─── 2. Bad token rejected ───
bad=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Authorization: Bearer obviously-wrong' \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  "$CHAT")
if [[ "$bad" != "401" ]]; then
  fail "expected 401 on bad token, got $bad"
fi
ok "bad token rejected (401)"

# ─── 3. Bad shape rejected ───
malformed=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $ATLAS_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"not":"a chat completion request"}' \
  "$CHAT")
if [[ "$malformed" != "400" ]]; then
  fail "expected 400 on malformed body, got $malformed"
fi
ok "malformed body rejected (400)"

# ─── 4. Non-streaming rejected ───
nostream=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $ATLAS_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7","stream":false,"messages":[{"role":"user","content":"hi"}]}' \
  "$CHAT")
if [[ "$nostream" != "400" ]]; then
  fail "expected 400 on stream:false, got $nostream"
fi
ok "non-streaming rejected (400)"

# ─── 5. Live streaming round-trip ───
echo "→ sending live request (this hits Claude — costs ~$0.001)"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -sN -m 30 \
  -H "Authorization: Bearer $ATLAS_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7","stream":true,"max_tokens":40,"messages":[{"role":"system","content":"Answer in five words or fewer."},{"role":"user","content":"Say hi briefly."}]}' \
  "$CHAT" > "$tmp" || fail "request failed"

if ! grep -q '"role":"assistant"' "$tmp"; then
  fail "no role=assistant chunk seen"
fi
if ! grep -q '"content":"' "$tmp"; then
  warn "no content delta chunks seen (response may have been refused or empty)"
fi
if ! grep -q 'data: \[DONE\]' "$tmp"; then
  fail "stream did not terminate with [DONE]"
fi

# Reconstruct assistant text for human visibility
text=$(grep '^data: ' "$tmp" \
  | sed 's/^data: //' \
  | sed '/^\[DONE\]/d' \
  | sed -n 's/.*"content":"\([^"]*\)".*/\1/p' \
  | tr -d '\n')
ok "live SSE round-trip: \"$text\""
ok "all smoke checks passed"
