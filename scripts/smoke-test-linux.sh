#!/usr/bin/env bash
# Atlas smoke test for Linux — exercises every feature that can be checked
# without spinning up the live voice loop. Run from the repo root:
#
#     bash scripts/smoke-test-linux.sh
#
# Or `bash scripts/smoke-test-linux.sh worker` to skip the rest, etc.
# Exits non-zero if any check fails.

set -u
cd "$(dirname "$0")/.."

# ─── Colors ───────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; B=$'\e[1m'; X=$'\e[0m'
else
  G=""; R=""; Y=""; D=""; B=""; X=""
fi

pass=0; fail=0; skip=0
ok()   { echo "${G}  ✓${X} $*"; pass=$((pass+1)); }
bad()  { echo "${R}  ✗${X} $*"; fail=$((fail+1)); }
warn() { echo "${Y}  ~${X} $*"; skip=$((skip+1)); }
hdr()  { echo; echo "${B}$*${X}"; }

# ─── Env ──────────────────────────────────────────────────────────────────
if [ ! -f .env.local ]; then
  echo "${R}✗ .env.local not found — run from the atlas repo root.${X}"
  exit 1
fi
set -a; source .env.local; set +a
ATLAS_TOKEN=$(grep -E '^ALLOWED_AGENT_TOKENS=' .env.local | cut -d= -f2- | cut -d, -f1 | tr -d '"' | xargs)
WORKER_URL="${ATLAS_WORKER_URL:-https://atlas-worker.a84580912.workers.dev}"

run_section() {
  case "${1:-all}" in all|"$2") return 0 ;; *) return 1 ;; esac
}
SECTION="${1:-all}"

# ─── 1. Deps ──────────────────────────────────────────────────────────────
if run_section "$SECTION" deps; then
  hdr "1. Linux dependencies"
  for bin in curl python3 ffmpeg xdotool grim scrot pactl wmctrl loginctl; do
    if command -v "$bin" >/dev/null 2>&1; then
      ok "$bin · $(command -v "$bin")"
    else
      case "$bin" in
        ffmpeg|xdotool) bad "$bin missing — \`sudo apt install $bin\`" ;;
        grim|scrot)     warn "$bin missing — install one (grim for Wayland, scrot for X11)" ;;
        *)              warn "$bin missing (used by some tools)" ;;
      esac
    fi
  done
fi

# ─── 2. Worker endpoints ──────────────────────────────────────────────────
if run_section "$SECTION" worker; then
  hdr "2. Cloudflare Worker tool routes"

  # 2a. web_search (Gemini grounding) — should return {answer, results}.
  resp=$(curl -s -m 30 -X POST "$WORKER_URL/v1/tools/web_search" \
    -H "authorization: Bearer $ATLAS_TOKEN" \
    -H 'content-type: application/json' \
    -d '{"query":"today top news headlines"}')
  ans=$(echo "$resp" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('answer','')[:80])" 2>/dev/null || echo "")
  srcs=$(echo "$resp" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
  if [ -n "$ans" ]; then
    ok "web_search → ${D}\"${ans}…\" · $srcs sources${X}"
  else
    bad "web_search failed: ${resp:0:200}"
  fi

  # 2b. vision_qa — needs a 1x1 PNG; we generate one with ffmpeg.
  tmp=/tmp/atlas-smoke-$$.png
  ffmpeg -y -loglevel error -f lavfi -i 'color=c=red:s=64x64' -frames:v 1 "$tmp" 2>/dev/null
  if [ -f "$tmp" ]; then
    resp=$(curl -s -m 30 -X POST "$WORKER_URL/v1/tools/vision_qa" \
      -H "authorization: Bearer $ATLAS_TOKEN" \
      -F "question=What color is this?" \
      -F "image=@$tmp;type=image/png")
    a=$(echo "$resp" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('answer','')[:80])" 2>/dev/null || echo "")
    if [ -n "$a" ]; then
      ok "vision_qa → ${D}\"${a}\"${X}"
    else
      bad "vision_qa failed: ${resp:0:200}"
    fi
    rm -f "$tmp"
  else
    warn "vision_qa skipped — ffmpeg couldn't generate test image"
  fi

  # 2c. generate_image — optional (costs $$, slow). Off by default.
  if [ "${SMOKE_GENERATE:-0}" = "1" ]; then
    resp=$(curl -s -m 60 -X POST "$WORKER_URL/v1/tools/generate_image" \
      -H "authorization: Bearer $ATLAS_TOKEN" \
      -H 'content-type: application/json' \
      -d '{"prompt":"a small brass key, studio lighting","count":1}')
    n=$(echo "$resp" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('images',[])))" 2>/dev/null || echo "0")
    if [ "$n" -gt 0 ]; then ok "generate_image → $n image(s)"; else bad "generate_image failed: ${resp:0:200}"; fi
  else
    warn "generate_image skipped — set SMOKE_GENERATE=1 to include it"
  fi
fi

# ─── 3. Desktop tool unit tests ───────────────────────────────────────────
if run_section "$SECTION" cargo; then
  hdr "3. Desktop tool unit tests (cargo)"
  out=$(cd apps/desktop/src-tauri && cargo test --lib --quiet tools:: 2>&1)
  total=$(echo "$out" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+' || echo "0")
  failed=$(echo "$out" | grep -oE '[0-9]+ failed' | head -1 | grep -oE '[0-9]+' || echo "0")
  if [ "$failed" = "0" ] && [ "$total" -gt 0 ]; then
    ok "$total tool tests passed (battery / clipboard / launch_app / press_key / send_email / …)"
  else
    bad "$failed test(s) failed, $total passed"
    echo "$out" | tail -20 | sed "s/^/    /"
  fi
fi

# ─── 4. Live tool behaviour (no app required) ─────────────────────────────
if run_section "$SECTION" tools; then
  hdr "4. Standalone Linux tools (the actual code paths the agent calls)"

  # 4a. battery_status — reads /sys/class/power_supply/BAT*.
  bat=$(ls /sys/class/power_supply 2>/dev/null | grep -E '^BAT' | head -1)
  if [ -n "$bat" ]; then
    cap=$(cat "/sys/class/power_supply/$bat/capacity" 2>/dev/null)
    stat=$(cat "/sys/class/power_supply/$bat/status" 2>/dev/null)
    ok "battery_status path · $bat · ${cap}% · ${stat}"
  else
    warn "battery_status would return present:false (no BAT* in /sys/class/power_supply — desktop?)"
  fi

  # 4b. screenshot — exercise the same capture vision_qa/screenshot use.
  out=/tmp/atlas-smoke-shot-$$.png
  if command -v grim >/dev/null 2>&1 && grim "$out" 2>/dev/null && [ -s "$out" ]; then
    sz=$(stat -c %s "$out")
    ok "screenshot path · grim → $out · $sz bytes"
    rm -f "$out"
  elif command -v scrot >/dev/null 2>&1 && scrot -o "$out" 2>/dev/null && [ -s "$out" ]; then
    sz=$(stat -c %s "$out")
    ok "screenshot path · scrot → $out · $sz bytes"
    rm -f "$out"
  else
    bad "screenshot — neither grim nor scrot produced a file"
  fi

  # 4c. launch_app discovery — count visible .desktop files.
  count=$(find /usr/share/applications /usr/local/share/applications \
                "$HOME/.local/share/applications" 2>/dev/null \
            -maxdepth 1 -name '*.desktop' 2>/dev/null | wc -l)
  if [ "$count" -gt 5 ]; then
    ok "launch_app · $count .desktop files discoverable"
  else
    warn "launch_app · only $count .desktop files found (system might have few GUI apps)"
  fi

  # 4d. system_action — does pactl talk to the audio stack?
  if pactl info >/dev/null 2>&1; then
    ok "system_action audio · pactl is talking to PipeWire/PulseAudio"
  else
    bad "system_action audio · pactl can't reach the sound server"
  fi
  if command -v brightnessctl >/dev/null 2>&1; then
    cur=$(brightnessctl get 2>/dev/null)
    ok "system_action brightness · brightnessctl reports $cur"
  else
    warn "brightnessctl missing — system_action brightness_up/_down won't work"
  fi

  # 4e. compose_email — would xdg-open handle a mailto:?
  if xdg-mime query default x-scheme-handler/mailto >/dev/null 2>&1; then
    h=$(xdg-mime query default x-scheme-handler/mailto)
    ok "compose_email · default mailto handler · $h"
  else
    warn "compose_email · no default mailto handler set"
  fi

  # 4f. send_email — Gmail OAuth env presence.
  if [ -n "${GMAIL_OAUTH_REFRESH_TOKEN:-}" ] && [ -n "${GMAIL_OAUTH_CLIENT_ID:-}" ] && [ -n "${GMAIL_OAUTH_CLIENT_SECRET:-}" ]; then
    tok=$(curl -s -m 15 https://oauth2.googleapis.com/token \
      -d "client_id=$GMAIL_OAUTH_CLIENT_ID" \
      -d "client_secret=$GMAIL_OAUTH_CLIENT_SECRET" \
      -d "refresh_token=$GMAIL_OAUTH_REFRESH_TOKEN" \
      -d "grant_type=refresh_token" \
      | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('access_token','')[:8])" 2>/dev/null || echo "")
    if [ -n "$tok" ]; then
      ok "send_email · Gmail OAuth refresh-token swap works (access token ${tok}…)"
    else
      bad "send_email · refresh-token swap failed — re-run docs/runbooks/gmail-oauth-setup.md"
    fi
  else
    warn "send_email · GMAIL_OAUTH_* not set; the agent will fall back to compose_email"
  fi

  # 4g. type_text / press_key — verify xdotool can speak to the X server.
  if command -v xdotool >/dev/null 2>&1; then
    if xdotool getactivewindow >/dev/null 2>&1; then
      ok "type_text / press_key · xdotool can reach the display"
    else
      warn "type_text / press_key · xdotool present but \`getactivewindow\` failed (Wayland?). Tools may need ydotool instead."
    fi
  else
    bad "type_text / press_key · xdotool missing — \`sudo apt install xdotool\`"
  fi

  # 4h. lock_screen — we DO NOT actually invoke it (would lock you out).
  if command -v loginctl >/dev/null 2>&1 && loginctl list-sessions >/dev/null 2>&1; then
    ok "lock_screen · loginctl would work (not invoked here on purpose)"
  else
    warn "lock_screen · loginctl unavailable; fallback would try xdg-screensaver / gnome-screensaver"
  fi
fi

# ─── 5. ElevenLabs agent registration ─────────────────────────────────────
if run_section "$SECTION" agent; then
  hdr "5. ElevenLabs agent state"
  if [ -z "${ELEVENLABS_API_KEY:-}" ] || [ -z "${ELEVENLABS_AGENT_ID:-}" ]; then
    warn "ELEVENLABS_API_KEY / _AGENT_ID not in .env.local — skipping agent check"
  else
    resp=$(curl -s "https://api.elevenlabs.io/v1/convai/agents/$ELEVENLABS_AGENT_ID" -H "xi-api-key: $ELEVENLABS_API_KEY")
    n=$(echo "$resp" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['conversation_config']['agent']['prompt'].get('tool_ids') or []))" 2>/dev/null || echo "")
    if [ -n "$n" ] && [ "$n" -ge 20 ]; then
      ok "agent · $n tools registered"
    else
      bad "agent check failed (got '$n' tools) — first 200 chars: ${resp:0:200}"
    fi
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────
echo
echo "${B}${pass} passed${X}  ${R}${fail} failed${X}  ${Y}${skip} warnings${X}"
[ "$fail" -eq 0 ]
