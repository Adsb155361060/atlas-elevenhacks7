#!/usr/bin/env bash
# Generate a strong random token for ALLOWED_AGENT_TOKENS.
# This token is the shared secret ElevenLabs Conversational Agent presents on
# every custom-LLM call in the `Authorization: Bearer …` header.
#
# Usage:
#   ./scripts/gen-agent-token.sh           # prints one token
#   ./scripts/gen-agent-token.sh 3         # prints three (rotation set)

set -euo pipefail

count="${1:-1}"
if ! [[ "$count" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: $0 [count]" >&2
  exit 2
fi

# 32 random bytes → 256 bits of entropy. base64url-encode for header-safe output.
# Pipe binary straight through; don't pass through a bash variable (null-byte truncation).
for ((i = 0; i < count; i++)); do
  head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'
  printf '\n'
done
