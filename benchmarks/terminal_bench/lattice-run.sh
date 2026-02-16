#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[lattice-run] %s\n' "$1"
}

fatal() {
  printf '[lattice-run] ERROR: %s\n' "$1" >&2
  exit 1
}

instruction=${1:-}
if [[ -z "${instruction}" ]]; then
  fatal "instruction argument is required"
fi

export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"
export PATH="${BUN_INSTALL}/bin:${PATH}"

LATTICE_APP_ROOT="${LATTICE_APP_ROOT:-/opt/lattice-app}"
LATTICE_CONFIG_ROOT="${LATTICE_CONFIG_ROOT:-/root/.lattice}"
LATTICE_PROJECT_PATH="${LATTICE_PROJECT_PATH:-}"
LATTICE_PROJECT_CANDIDATES="${LATTICE_PROJECT_CANDIDATES:-/workspace:/app:/workspaces:/root/project}"
LATTICE_MODEL="${LATTICE_MODEL:-anthropic:claude-sonnet-4-5}"
LATTICE_TIMEOUT_MS="${LATTICE_TIMEOUT_MS:-}"
LATTICE_WORKSPACE_ID="${LATTICE_WORKSPACE_ID:-lattice-bench}"
LATTICE_THINKING_LEVEL="${LATTICE_THINKING_LEVEL:-high}"
LATTICE_MODE="${LATTICE_MODE:-exec}"
LATTICE_RUNTIME="${LATTICE_RUNTIME:-}"
LATTICE_EXPERIMENTS="${LATTICE_EXPERIMENTS:-}"

resolve_project_path() {
  if [[ -n "${LATTICE_PROJECT_PATH}" ]]; then
    if [[ -d "${LATTICE_PROJECT_PATH}" ]]; then
      printf '%s\n' "${LATTICE_PROJECT_PATH}"
      return 0
    fi
    fatal "LATTICE_PROJECT_PATH=${LATTICE_PROJECT_PATH} not found"
  fi

  IFS=":" read -r -a candidates <<<"${LATTICE_PROJECT_CANDIDATES}"
  for candidate in "${candidates[@]}"; do
    if [[ -d "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  fatal "no project path located (searched ${LATTICE_PROJECT_CANDIDATES})"
}

command -v bun >/dev/null 2>&1 || fatal "bun is not installed"
project_path=$(resolve_project_path)

log "starting lattice agent session for ${project_path}"
cd "${LATTICE_APP_ROOT}"

cmd=(bun src/cli/run.ts
  --dir "${project_path}"
  --model "${LATTICE_MODEL}"
  --mode "${LATTICE_MODE}"
  --thinking "${LATTICE_THINKING_LEVEL}"
  --json)

if [[ -n "${LATTICE_RUNTIME}" ]]; then
  cmd+=(--runtime "${LATTICE_RUNTIME}")
fi

# Add experiment flags (comma-separated → repeated --experiment flags)
if [[ -n "${LATTICE_EXPERIMENTS}" ]]; then
  IFS=',' read -r -a experiments <<<"${LATTICE_EXPERIMENTS}"
  for exp in "${experiments[@]}"; do
    # Trim whitespace
    exp="${exp#"${exp%%[![:space:]]*}"}"
    exp="${exp%"${exp##*[![:space:]]}"}"
    if [[ -n "${exp}" ]]; then
      cmd+=(--experiment "${exp}")
    fi
  done
fi

LATTICE_OUTPUT_FILE="/tmp/lattice-output.jsonl"
LATTICE_TOKEN_FILE="/tmp/lattice-tokens.json"

# Wrap command with timeout if LATTICE_TIMEOUT_MS is set (converts ms to seconds)
if [[ -n "${LATTICE_TIMEOUT_MS}" ]]; then
  timeout_sec=$((LATTICE_TIMEOUT_MS / 1000))
  cmd=(timeout "${timeout_sec}s" "${cmd[@]}")
fi

# Terminal-bench enforces timeouts via --global-agent-timeout-sec
# Capture output to file while streaming to terminal for token extraction
if ! printf '%s' "${instruction}" | "${cmd[@]}" | tee "${LATTICE_OUTPUT_FILE}"; then
  fatal "lattice agent session failed"
fi

# Extract tokens from stream-end events (best-effort, sums all events)
python3 -c '
import json, sys
total_input = total_output = 0
for line in open(sys.argv[1]):
    try:
        obj = json.loads(line)
        if obj.get("type") == "event":
            p = obj.get("payload", {})
            if p.get("type") == "stream-end":
                u = p.get("metadata", {}).get("usage", {})
                total_input += u.get("inputTokens", 0) or 0
                total_output += u.get("outputTokens", 0) or 0
    except: pass
print(json.dumps({"input": total_input, "output": total_output}))
' "${LATTICE_OUTPUT_FILE}" > "${LATTICE_TOKEN_FILE}" 2>/dev/null || true
