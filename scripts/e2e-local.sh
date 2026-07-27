#!/usr/bin/env bash
#
# End-to-end local smoke test for the whole stack, culminating in an avatar
# "hello world" chat:
#
#   Ollama → HomePilot → OllaBridge Local → yourfriend.online
#
# It starts each service from its repo (sibling checkouts by default), waits
# for health, runs tests/e2e/hello_world_e2e.py, then tears everything back
# down. Non-destructive: it never installs system packages and only launches
# processes it also stops. If a prerequisite (ollama/node/python) is missing it
# tells you and exits.
#
# Layout (override via env):
#   HOMEPILOT_DIR   ../HomePilot
#   OLLABRIDGE_DIR  ../ollabridge
#   APP_DIR         .            (this repo)
#   MODEL           qwen2.5:0.5b (a light model to keep the test fast)
#   SKIP_INSTALL=1  skip `make install` in each repo (faster re-runs)
#   KEEP_UP=1       leave services running after the test (for debugging)
#
# Usage:  bash scripts/e2e-local.sh
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOMEPILOT_DIR="${HOMEPILOT_DIR:-$(cd "$HERE/../HomePilot" 2>/dev/null && pwd || echo "$HERE/../HomePilot")}"
OLLABRIDGE_DIR="${OLLABRIDGE_DIR:-$(cd "$HERE/../ollabridge" 2>/dev/null && pwd || echo "$HERE/../ollabridge")}"
APP_DIR="${APP_DIR:-$HERE}"
MODEL="${MODEL:-qwen2.5:0.5b}"

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
HOMEPILOT_URL="${HOMEPILOT_URL:-http://localhost:8000}"
OLLABRIDGE_URL="${OLLABRIDGE_URL:-http://localhost:11435}"
APP_URL="${APP_URL:-http://localhost:8080}"

LOG_DIR="$(mktemp -d)"
PIDS=()

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { c 36 "▸ $*"; }
ok() { c 32 "✓ $*"; }
die() { c 31 "✗ $*"; exit 1; }

cleanup() {
  if [[ "${KEEP_UP:-0}" == "1" ]]; then
    info "KEEP_UP=1 — leaving services running. Logs in $LOG_DIR"
    return
  fi
  info "Stopping services…"
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
}
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found. Install it first ($2)."; }

wait_health() {  # name url path timeout_s
  local name="$1" url="$2" path="$3" timeout="${4:-90}" i=0
  info "Waiting for $name at $url$path (up to ${timeout}s)…"
  while (( i < timeout )); do
    if curl -fsS "$url$path" >/dev/null 2>&1; then ok "$name is up"; return 0; fi
    sleep 2; i=$((i+2))
  done
  echo "---- last 40 log lines for $name ----"; tail -n 40 "$LOG_DIR/$name.log" 2>/dev/null || true
  die "$name did not become healthy in ${timeout}s"
}

start_svc() {  # name dir command...
  local name="$1" dir="$2"; shift 2
  [[ -d "$dir" ]] || die "$name directory not found: $dir (set ${name}_DIR)."
  info "Starting $name  ($dir: $*)"
  ( cd "$dir" && exec "$@" ) >"$LOG_DIR/$name.log" 2>&1 &
  PIDS+=("$!")
}

# ── Prerequisites ────────────────────────────────────────────────────────────
need ollama "https://ollama.com/download"
need node "https://nodejs.org"
need curl "your package manager"
PY="$(command -v python3 || command -v python)" || die "python3 not found."

# ── 1. Ollama + a light model ────────────────────────────────────────────────
info "Ensuring Ollama is running and '$MODEL' is available…"
curl -fsS "$OLLAMA_URL/api/tags" >/dev/null 2>&1 || { ollama serve >"$LOG_DIR/ollama.log" 2>&1 & PIDS+=("$!"); }
wait_health ollama "$OLLAMA_URL" "/api/tags" 60
if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$MODEL"; then
  info "Pulling light model $MODEL (one-time)…"; ollama pull "$MODEL"
fi
ok "Ollama ready with $MODEL"

# ── 2. HomePilot ── (make install && make run) ────────────────────────────────
if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  info "HomePilot: make install"; ( cd "$HOMEPILOT_DIR" && make install ) >"$LOG_DIR/homepilot-install.log" 2>&1 \
    || die "HomePilot 'make install' failed — see $LOG_DIR/homepilot-install.log"
fi
start_svc homepilot "$HOMEPILOT_DIR" make run
wait_health homepilot "$HOMEPILOT_URL" "/health" 180

# ── 3. OllaBridge Local ── (make run, serves :11435) ─────────────────────────
if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  info "OllaBridge: make install"; ( cd "$OLLABRIDGE_DIR" && make install ) >"$LOG_DIR/ollabridge-install.log" 2>&1 \
    || die "OllaBridge 'make install' failed — see $LOG_DIR/ollabridge-install.log"
fi
start_svc ollabridge "$OLLABRIDGE_DIR" make run
wait_health ollabridge "$OLLABRIDGE_URL" "/health" 120

# ── 4. yourfriend.online (3D Avatar Chatbot) ─────────────────────────────────
start_svc app "$APP_DIR" make start
wait_health app "$APP_URL" "/" 90

# ── 5. The hello-world assertion through the whole chain ─────────────────────
info "Running the hello-world E2E assertion…"
OLLAMA_URL="$OLLAMA_URL" HOMEPILOT_URL="$HOMEPILOT_URL" OLLABRIDGE_URL="$OLLABRIDGE_URL" \
  APP_URL="$APP_URL" "$PY" "$APP_DIR/tests/e2e/hello_world_e2e.py"

ok "End-to-end smoke test passed."
