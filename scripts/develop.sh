#!/usr/bin/env bash

# Usage: ./scripts/develop.sh [--server] [--sandbox] [--backend-port PORT] [--vite-port PORT]
#
# Starts Lattice Workbench in development mode with hot reload for both
# frontend (Vite HMR) and backend (nodemon + tsgo watch).
#
# Modes:
#   (default)     Electron desktop mode — Vite + watchers + Electron
#   --server      Web server mode — backend on :3000 + frontend on :5173
#   --sandbox     Isolated instance — temp LATTICE_ROOT, free ports, clean state
#
# Options:
#   --backend-port PORT   Override backend port (default: 3000, server mode only)
#   --vite-port PORT      Override Vite dev server port (default: 5173)
#   --keep-sandbox        Don't delete sandbox temp dir on exit
#   --help                Show this help message
#
# Environment variables (optional):
#   ANTHROPIC_API_KEY     Anthropic API key for AI features
#   OPENAI_API_KEY        OpenAI API key for AI features
#   LATTICE_SERVER_AUTH_TOKEN  Bearer token for server auth
#   SEED_LATTICE_ROOT        Path to copy providers/config from (sandbox mode)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ─── Defaults ────────────────────────────────────────────────────────────────
mode="desktop"        # desktop | server
sandbox=0
backend_port=3000
vite_port=5173
keep_sandbox=0

# ─── Colors & logging ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()   { echo -e "${CYAN}==${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}== WARNING:${NC} $*" >&2; }
error() { echo -e "${RED}== ERROR:${NC} $*" >&2; exit 1; }

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)
      mode="server"
      shift
      ;;
    --sandbox)
      sandbox=1
      shift
      ;;
    --backend-port)
      backend_port="$2"
      shift 2
      ;;
    --vite-port)
      vite_port="$2"
      shift 2
      ;;
    --keep-sandbox)
      keep_sandbox=1
      shift
      ;;
    --help|-h)
      head -24 "${BASH_SOURCE[0]}" | tail -21
      exit 0
      ;;
    *)
      error "Unknown option: $1. Run with --help for usage."
      ;;
  esac
done

# ─── Dependency checks ───────────────────────────────────────────────────────
check_dependency() {
  if ! command -v "$1" &>/dev/null; then
    error "'$1' is required but not found. $2"
  fi
}

check_dependency node "Install Node.js v20+ from https://nodejs.org"
check_dependency bun "Install bun from https://bun.sh"
check_dependency make "Install make (brew install make on macOS)"

NODE_MAJOR="$(node --version | sed 's/v\([0-9]*\).*/\1/')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  error "Node.js v20+ required (found v${NODE_MAJOR}). Run: sudo n 20"
fi

# ─── Load .env if present ────────────────────────────────────────────────────
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  log "Loading environment from .env"
  set -a
  # shellcheck source=/dev/null
  source "${PROJECT_ROOT}/.env"
  set +a
fi

# ─── Port helpers ─────────────────────────────────────────────────────────────
get_free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()' 2>/dev/null \
    || node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})'
}

check_port() {
  local port=$1
  if lsof -ti :"${port}" &>/dev/null; then
    local pid
    pid="$(lsof -ti :"${port}" 2>/dev/null | head -1)"
    warn "Port ${port} is in use (PID ${pid})."
    return 1
  fi
  return 0
}

ensure_port_free() {
  local port=$1
  local name=$2
  if ! check_port "$port"; then
    local pid
    pid="$(lsof -ti :"${port}" 2>/dev/null | head -1)"
    warn "Killing process ${pid} on port ${port} (${name})..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
    if ! check_port "$port"; then
      error "Could not free port ${port} for ${name}. Kill it manually and retry."
    fi
    log "Port ${port} is now free."
  fi
}

# ─── Sandbox setup ────────────────────────────────────────────────────────────
SANDBOX_ROOT=""
cleanup_sandbox() {
  if [[ -n "$SANDBOX_ROOT" && "$keep_sandbox" -eq 0 ]]; then
    log "Cleaning up sandbox at ${SANDBOX_ROOT}..."
    rm -rf "$SANDBOX_ROOT" 2>/dev/null || true
  elif [[ -n "$SANDBOX_ROOT" && "$keep_sandbox" -eq 1 ]]; then
    log "Keeping sandbox at ${SANDBOX_ROOT}"
  fi
}

if [[ "$sandbox" -eq 1 ]]; then
  SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lattice-workbench-dev-XXXXXX")"
  export LATTICE_ROOT="$SANDBOX_ROOT"

  # Seed config from existing home if available
  SEED="${SEED_LATTICE_ROOT:-${HOME}/.lattice-dev}"
  if [[ -d "$SEED" ]]; then
    [[ -f "$SEED/providers.jsonc" ]] && cp "$SEED/providers.jsonc" "$SANDBOX_ROOT/" && log "Seeded providers.jsonc"
    [[ -f "$SEED/config.json" ]] && cp "$SEED/config.json" "$SANDBOX_ROOT/" && log "Seeded config.json"
  fi

  # Pick free ports in sandbox mode
  backend_port="$(get_free_port)"
  vite_port="$(get_free_port)"
  while [[ "$vite_port" -eq "$backend_port" ]]; do
    vite_port="$(get_free_port)"
  done

  trap cleanup_sandbox EXIT
fi

# ─── Install dependencies ────────────────────────────────────────────────────
cd "$PROJECT_ROOT"

if [[ ! -d node_modules ]] || [[ package.json -nt node_modules/.installed ]] || [[ bun.lock -nt node_modules/.installed ]]; then
  log "Installing dependencies..."
  bun install
  touch node_modules/.installed
fi

# ─── Initial build ───────────────────────────────────────────────────────────
log "Building main process (initial compile)..."
make build-main

# ─── Process management ──────────────────────────────────────────────────────
PIDS=()

cleanup() {
  set +e
  trap '' INT TERM EXIT

  log "Shutting down..."

  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  # Give processes time to exit gracefully
  sleep 2

  for pid in "${PIDS[@]}"; do
    kill -9 "$pid" 2>/dev/null || true
  done

  cleanup_sandbox
  exit 0
}

trap cleanup INT TERM EXIT

start_process() {
  local name="$1"
  shift

  log "Starting ${name}..."
  FORCE_COLOR=1 "$@" > >(
    trap '' INT
    while IFS= read -r line; do
      echo -e "${BOLD}[${name}]${NC} ${line}"
    done
  ) 2>&1 &
  PIDS+=("$!")
}

# ─── Launch ──────────────────────────────────────────────────────────────────

BUN_OR_NPX="$(command -v bun >/dev/null 2>&1 && echo "bun x" || echo "npx")"
BUN_OR_NODE="$(command -v bun >/dev/null 2>&1 && echo "bun run" || echo "node")"
TSGO="${BUN_OR_NODE} node_modules/@typescript/native-preview/bin/tsgo.js"

# Common esbuild flags
ESBUILD_CLI_FLAGS="--bundle --format=esm --platform=node --target=node20 --outfile=dist/cli/api.mjs --external:zod --external:commander --external:jsonc-parser --external:@trpc/server --external:ssh2 --external:cpu-features --external:trpc-cli --external:@orpc/client --external:@orpc/client/fetch --external:@orpc/server --external:ai --banner:js=\"import{createRequire}from'module';globalThis.require=createRequire(import.meta.url);\""

if [[ "$mode" == "server" ]]; then
  # ─── Server mode ──────────────────────────────────────────────────────────
  ensure_port_free "$backend_port" "backend"
  ensure_port_free "$vite_port" "vite"

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║        Lattice Workbench — Server Development Mode          ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}Backend (API/WS):${NC}  http://127.0.0.1:${backend_port}"
  echo -e "  ${CYAN}Frontend (HMR):${NC}    http://localhost:${vite_port}"
  [[ -n "$SANDBOX_ROOT" ]] && echo -e "  ${CYAN}LATTICE_ROOT:${NC}         ${SANDBOX_ROOT}"
  echo ""
  echo -e "  ${YELLOW}Press Ctrl+C to stop all processes${NC}"
  echo ""

  # 1. TypeScript watcher (tsgo + tsc-alias for backend)
  start_process "TS Watch" bash -c "${TSGO} -w -p tsconfig.main.json 2>&1 & ${BUN_OR_NPX} tsc-alias -w -p tsconfig.main.json 2>&1 & wait"

  # 2. esbuild watcher (CLI API bundle)
  start_process "ESBuild" bash -c "${BUN_OR_NPX} esbuild src/cli/api.ts ${ESBUILD_CLI_FLAGS} --watch"

  # 3. Wait for the TS watcher's first compile + tsc-alias pass before starting the backend.
  #    Without this, nodemon starts while dist still has unresolved @/ path aliases
  #    (tsgo -w rewrites dist, then tsc-alias -w resolves the paths ~1s later).
  log "Waiting for TypeScript watcher to complete first compile..."
  _ts_timeout=30
  _ts_elapsed=0
  # Wait until dist/cli/server.js has no unresolved @/ requires (tsc-alias has run)
  sleep 2  # Give tsgo -w time to start its first recompile
  while grep -q 'require("@/' dist/cli/server.js 2>/dev/null; do
    sleep 0.5
    _ts_elapsed=$((_ts_elapsed + 1))
    if [[ "$_ts_elapsed" -ge "$((_ts_timeout * 2))" ]]; then
      warn "Path aliases not resolved after ${_ts_timeout}s — starting backend anyway"
      break
    fi
  done
  log "Path aliases resolved, starting backend."

  # 4. Backend server with nodemon (restarts on recompile)
  # --no-auth: skip token auth for local dev, matching Makefile's dev-server target
  start_process "Backend" bash -c "${BUN_OR_NPX} nodemon --watch dist/cli/index.js --watch dist/cli/server.js --watch dist/node --delay 3000ms --exec 'NODE_ENV=development node dist/cli/index.js server --no-auth --host 127.0.0.1 --port ${backend_port}'"

  # 5. Wait for backend to be ready before starting Vite (avoids EPIPE errors)
  log "Waiting for backend on port ${backend_port}..."
  _be_timeout=60
  _be_elapsed=0
  while ! curl -sf "http://127.0.0.1:${backend_port}/health" >/dev/null 2>&1; do
    sleep 0.5
    _be_elapsed=$((_be_elapsed + 1))
    if [[ "$_be_elapsed" -ge "$((_be_timeout * 2))" ]]; then
      warn "Backend did not start within ${_be_timeout}s — starting Vite anyway"
      break
    fi
  done
  log "Backend is ready, starting Vite..."

  # 6. Vite frontend dev server (proxies API calls to backend)
  start_process "Frontend" bash -c "LATTICE_VITE_HOST=127.0.0.1 LATTICE_VITE_PORT=${vite_port} LATTICE_BACKEND_PORT=${backend_port} ${BUN_OR_NPX} vite"

else
  # ─── Desktop (Electron) mode ──────────────────────────────────────────────
  ensure_port_free "$vite_port" "vite"

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║       Lattice Workbench — Desktop Development Mode          ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}Vite (HMR):${NC}        http://localhost:${vite_port}"
  [[ -n "$SANDBOX_ROOT" ]] && echo -e "  ${CYAN}LATTICE_ROOT:${NC}         ${SANDBOX_ROOT}"
  echo ""
  echo -e "  ${YELLOW}Electron will launch once Vite is ready${NC}"
  echo -e "  ${YELLOW}Press Ctrl+C to stop all processes${NC}"
  echo ""

  # Build preload script for Electron
  make build-preload 2>/dev/null || true

  # 1. TypeScript watcher (tsgo + tsc-alias for backend/desktop)
  start_process "TS Watch" bash -c "${TSGO} -w -p tsconfig.main.json 2>&1 & ${BUN_OR_NPX} tsc-alias -w -p tsconfig.main.json 2>&1 & wait"

  # 2. esbuild watcher (CLI API bundle)
  start_process "ESBuild" bash -c "${BUN_OR_NPX} esbuild src/cli/api.ts ${ESBUILD_CLI_FLAGS} --watch"

  # 3. Vite frontend dev server
  start_process "Frontend" bash -c "LATTICE_VITE_PORT=${vite_port} ${BUN_OR_NPX} vite"

  # 4. Wait for Vite to be ready, then launch Electron
  log "Waiting for Vite to be ready..."
  TIMEOUT=60
  ELAPSED=0
  while ! curl -sf "http://localhost:${vite_port}" >/dev/null 2>&1; do
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
    if [[ "$ELAPSED" -ge "$((TIMEOUT * 2))" ]]; then
      error "Vite did not start within ${TIMEOUT}s"
    fi
  done
  log "Vite is ready!"

  # Build static assets for Electron (splash screen, etc.)
  make build-static 2>/dev/null || true

  # Launch Electron
  start_process "Electron" bash -c "NODE_ENV=development LATTICE_DEVSERVER_HOST=127.0.0.1 LATTICE_DEVSERVER_PORT=${vite_port} bunx electron --remote-debugging-port=9222 ."
fi

# ─── Wait ────────────────────────────────────────────────────────────────────
log "All processes running. Watching for changes..."
wait "${PIDS[@]}" 2>/dev/null || true
