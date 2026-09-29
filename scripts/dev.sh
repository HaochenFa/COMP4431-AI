#!/usr/bin/env bash
# One command for a local Trailhead session: Ollama (embeddings), the backend, Metro, and the app in a simulator it boots and shows.
#
#   scripts/dev.sh                     start everything, reusing whatever is already running
#   scripts/dev.sh --build             rebuild the native app first (after adding a native package or editing app.config.ts)
#   scripts/dev.sh --profile ollama    pick the LLM profile for this run (default: LLM_PROFILE in backend/.env)
#   scripts/dev.sh --no-ollama         skip the local Ollama server (search_knowledge then reports "embedder offline")
#   scripts/dev.sh --device "iPhone 17"
#
# The native app is only built when it isn't installed on the simulator yet (or with --build): JS changes reach it
# through Metro, so the slow Xcode build is a one-off. Metro runs in the foreground (r = reload, j = debugger);
# Ctrl-C stops Metro and every service this script started. Logs go to .logs/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_ID="hk.comp4431.trailhead"
LOGS="$ROOT/.logs"
BUILD=0 OLLAMA=1 PROFILE="" DEVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1 ;;
    --no-ollama) OLLAMA=0 ;;
    --profile) PROFILE="$2"; shift ;;
    --device) DEVICE="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$LOGS"
say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
# Local HTTP clients here go through a SOCKS proxy unless told not to.
get() { curl -fsS --noproxy '*' --max-time 2 "$@"; }

STARTED_PIDS=() STARTED_PORTS=()
cleanup() {
  trap - EXIT INT TERM
  [[ ${#STARTED_PIDS[@]} -eq 0 ]] && return
  say "Stopping the services this script started"
  kill "${STARTED_PIDS[@]}" 2>/dev/null || true
  # uv and the Ollama wrapper may leave the real server behind; free the ports we opened.
  for port in "${STARTED_PORTS[@]}"; do
    lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT TERM
# set -e would otherwise exit without a word.
trap 'printf "\033[1;31m==>\033[0m Failed at scripts/dev.sh:%s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

# $1 = what, $2 = seconds, then the check command
wait_for() {
  local what="$1" secs="$2"; shift 2
  for ((i = 0; i < secs; i++)); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "$what didn't come up within ${secs}s"
}

# --- Ollama (bge-m3 embeddings for search_knowledge; also the chat model for the ollama* profiles) ---
if [[ $OLLAMA == 1 ]]; then
  if listening 11435; then
    say "Ollama already running on :11435"
  elif command -v ollama >/dev/null; then
    say "Starting Ollama on :11435 (log: .logs/ollama.log)"
    "$ROOT/scripts/ollama_serve.sh" >"$LOGS/ollama.log" 2>&1 &
    STARTED_PIDS+=($!) STARTED_PORTS+=(11435)
    wait_for "Ollama" 20 listening 11435
  else
    warn "ollama isn't installed: trail knowledge search will be offline (planning still works)"
  fi
fi

# --- Backend ---
if listening 8000; then
  warn "Something is already on :8000; reusing it (stop it first to change the profile)"
else
  say "Starting the backend on :8000 (log: .logs/backend.log)"
  (
    cd "$ROOT/backend"
    [[ -n $PROFILE ]] && export LLM_PROFILE="$PROFILE"
    exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
  ) >"$LOGS/backend.log" 2>&1 &
  STARTED_PIDS+=($!) STARTED_PORTS+=(8000)
fi
wait_for "The backend (see .logs/backend.log)" 60 get http://localhost:8000/health
say "Backend: $(get http://localhost:8000/health)"

# --- Simulator ---
# UDIDs of the matching `simctl list devices` lines, in list order (empty, not an error, when none match).
udids() { xcrun simctl list devices "$1" | { grep -E "$2" || true; } | grep -Eo '[0-9A-F-]{36}' || true; }
# Whether the app is installed, without booting the device.
has_app() { compgen -G "$HOME/Library/Developer/CoreSimulator/Devices/$1/data/Containers/Bundle/Application/*/Trailhead.app" >/dev/null; }

if [[ -n $DEVICE ]]; then
  UDID="$(udids available "^ +$DEVICE \(" | head -1)"
  [[ -n $UDID ]] || die "No simulator named \"$DEVICE\" (xcrun simctl list devices available)"
else
  UDID="$(udids booted '^ +iPhone' | head -1)"
  if [[ -z $UDID ]]; then
    # Nothing booted: prefer an iPhone that already has the app (no rebuild), else the first iPhone listed.
    for u in $(udids available '^ +iPhone'); do
      has_app "$u" && { UDID="$u"; break; }
    done
    [[ -n $UDID ]] || UDID="$(udids available '^ +iPhone' | head -1)"
    [[ -n $UDID ]] || die "No iPhone simulator available (install an iOS runtime in Xcode → Settings → Components)"
  fi
fi
xcrun simctl boot "$UDID" 2>/dev/null || true  # already booted is fine
xcrun simctl bootstatus "$UDID" -b >/dev/null
# Show the device: Device Hub since Xcode 27 (it replaced Simulator.app), Simulator.app before that.
open -b com.apple.dt.Devices 2>/dev/null ||
  open -b com.apple.iphonesimulator --args -CurrentDeviceUDID "$UDID" 2>/dev/null ||
  warn "Couldn't open Device Hub or Simulator.app; the device is running headless"
say "Simulator: $(xcrun simctl list devices | grep -F "$UDID" | head -1 | sed -E 's/^ +//; s/ \(.*//')"

# --- Native app (one-off build) ---
if [[ $BUILD == 1 ]] || ! xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" app >/dev/null 2>&1; then
  say "Building and installing the native app (a few minutes; only needed once, or after native changes)"
  (cd "$ROOT/mobile" && LANG=en_US.UTF-8 npx expo run:ios --no-bundler --device "$UDID")
fi

launch_app() {
  wait_for "Metro" 90 sh -c "curl -fsS --noproxy '*' --max-time 2 http://localhost:8081/status | grep -q running"
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null
  say "Launched Trailhead (the first load bundles the JS; give it a few seconds)"
}

# --- Metro + app ---
cd "$ROOT/mobile"
if listening 8081; then
  say "Metro already running on :8081; relaunching the app"
  launch_app
  say "Following the backend log (Ctrl-C to stop the services this script started)"
  touch "$LOGS/backend.log"
  tail -f "$LOGS/backend.log"
else
  say "Starting Metro on :8081 (r = reload the app, Ctrl-C = stop everything)"
  launch_app &
  npx expo start --dev-client --port 8081
fi
