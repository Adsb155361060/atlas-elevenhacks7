#!/usr/bin/env bash
# Atlas one-shot local environment setup. Idempotent.
# Verifies toolchain versions, installs Linux Tauri prereqs, installs wrangler.
# Per §1.3 of jarvis_dev_plan.md.

set -euo pipefail

C_BLUE='\033[0;34m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_YELLOW='\033[1;33m'; C_NC='\033[0m'

ok()    { printf "${C_GREEN}✓${C_NC} %s\n" "$1"; }
warn()  { printf "${C_YELLOW}⚠${C_NC} %s\n" "$1"; }
fail()  { printf "${C_RED}✗${C_NC} %s\n" "$1"; FAIL=1; }
info()  { printf "${C_BLUE}→${C_NC} %s\n" "$1"; }

FAIL=0

# ───── Required toolchain ─────
info "Checking required toolchain…"

if command -v rustup >/dev/null 2>&1; then
  ok "rustup: $(rustup --version 2>/dev/null | head -1)"
else
  fail "rustup not found — install: https://rustup.rs"
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    ok "node: $(node --version)"
  else
    warn "node version $(node --version) — recommended ≥ v22 LTS"
  fi
else
  fail "node not found — install Node 22 LTS"
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm: $(pnpm --version)"
else
  fail "pnpm not found — install: npm install -g pnpm@9"
fi

if command -v cargo >/dev/null 2>&1; then
  ok "cargo: $(cargo --version)"
else
  fail "cargo not found — install via rustup"
fi

if command -v git >/dev/null 2>&1; then
  ok "git: $(git --version)"
else
  fail "git not found"
fi

# ───── Linux Tauri prereqs ─────
if [[ "$(uname -s)" == "Linux" ]]; then
  info "Checking Linux Tauri 2 prerequisites (apt-based)…"
  REQUIRED_PKGS=(
    libwebkit2gtk-4.1-dev
    build-essential
    curl
    wget
    file
    libxdo-dev
    libssl-dev
    libayatana-appindicator3-dev
    librsvg2-dev
    libasound2-dev
    libv4l-dev
    pkg-config
  )
  MISSING=()
  for pkg in "${REQUIRED_PKGS[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      MISSING+=("$pkg")
    fi
  done
  if [ ${#MISSING[@]} -eq 0 ]; then
    ok "all Tauri Linux deps present"
  else
    warn "missing Tauri deps: ${MISSING[*]}"
    info "to install: sudo apt install -y ${MISSING[*]}"
  fi

  # Optional but recommended runtime tools
  for tool in ydotool wmctrl xdotool brightnessctl pactl direnv; do
    if command -v "$tool" >/dev/null 2>&1; then
      ok "$tool present"
    else
      warn "$tool not installed (optional but recommended)"
    fi
  done
fi

# ───── Tauri CLI ─────
info "Checking Tauri CLI…"
if cargo install --list 2>/dev/null | grep -q "^tauri-cli "; then
  ok "tauri-cli installed"
else
  warn "tauri-cli not installed — run: cargo install tauri-cli --version '^2.0'"
fi

# ───── Wrangler ─────
info "Checking Wrangler (Cloudflare)…"
if command -v wrangler >/dev/null 2>&1; then
  ok "wrangler: $(wrangler --version 2>/dev/null | head -1)"
else
  warn "wrangler not installed — run: pnpm add -g wrangler"
fi

# ───── Hardware sanity (Linux only, non-fatal) ─────
if [[ "$(uname -s)" == "Linux" ]]; then
  info "Hardware sanity (non-fatal)…"
  if command -v arecord >/dev/null 2>&1 && arecord -l 2>/dev/null | grep -q card; then
    ok "audio input device detected"
  else
    warn "no audio input detected (arecord -l)"
  fi
  if command -v v4l2-ctl >/dev/null 2>&1 && v4l2-ctl --list-devices >/dev/null 2>&1; then
    ok "video device detected"
  else
    warn "no video device detected (install v4l-utils, attach webcam)"
  fi
fi

# ───── .env.local check ─────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env.local" ]; then
  ok ".env.local present"
else
  warn ".env.local missing — run: cp .env.example .env.local && \$EDITOR .env.local"
fi

# ───── Summary ─────
echo
if [ "$FAIL" -eq 0 ]; then
  ok "setup check complete — fix any warnings above, then run 'pnpm install'"
  exit 0
else
  fail "setup has missing required tools — install them before continuing"
  exit 1
fi
