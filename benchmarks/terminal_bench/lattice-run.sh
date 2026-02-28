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

# Prefer an explicit LATTICE_CONFIG_ROOT, but fall back to LATTICE_ROOT for callers that
# only override the lattice home via LATTICE_ROOT.
LATTICE_CONFIG_ROOT="${LATTICE_CONFIG_ROOT:-${LATTICE_ROOT:-/root/.lattice}}"

# Export LATTICE_ROOT so lattice's getLatticeHome() finds providers.jsonc and other config.
# Don't clobber caller-provided LATTICE_ROOT (e.g. local runs/tests with a custom root).
export LATTICE_ROOT="${LATTICE_ROOT:-${LATTICE_CONFIG_ROOT}}"
LATTICE_PROJECT_PATH="${LATTICE_PROJECT_PATH:-}"
LATTICE_PROJECT_CANDIDATES="${LATTICE_PROJECT_CANDIDATES:-/workspace:/app:/workspaces:/root/project}"
LATTICE_MODEL="${LATTICE_MODEL:-anthropic:claude-sonnet-4-5}"
LATTICE_TIMEOUT_MS="${LATTICE_TIMEOUT_MS:-}"
LATTICE_WORKSPACE_ID="${LATTICE_WORKSPACE_ID:-lattice-bench}"
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
  --keep-background-processes
  --json)

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

# Append arbitrary lattice run flags (e.g., --thinking high --mode exec --use-1m --budget 5.00)
if [[ -n "${LATTICE_RUN_ARGS:-}" ]]; then
  # Word-split intentional: LATTICE_RUN_ARGS contains space-separated CLI flags
  # shellcheck disable=SC2206
  cmd+=(${LATTICE_RUN_ARGS})
fi

# NOTE: Harbor only automatically collects /logs/agent on timeouts.
# Persist stdout/stderr there so we can inspect partial agent output even when
# the trial hits AgentTimeoutError and the exec call is cancelled.
LATTICE_LOG_DIR="/logs/agent/command-0"
mkdir -p "${LATTICE_LOG_DIR}"
LATTICE_OUTPUT_FILE="${LATTICE_LOG_DIR}/stdout.txt"
LATTICE_STDERR_FILE="${LATTICE_LOG_DIR}/stderr.txt"
LATTICE_TOKEN_FILE="/tmp/lattice-tokens.json"

# Wrap command with timeout if LATTICE_TIMEOUT_MS is set (converts ms to seconds)
if [[ -n "${LATTICE_TIMEOUT_MS}" ]]; then
  timeout_sec=$((LATTICE_TIMEOUT_MS / 1000))
  cmd=(timeout "${timeout_sec}s" "${cmd[@]}")
fi

# Capture output to file while streaming to terminal for token extraction.
# Keep stderr separate so the stdout log stays valid JSONL.
if ! printf '%s' "${instruction}" \
  | "${cmd[@]}" \
    2> >(tee "${LATTICE_STDERR_FILE}" >&2) \
  | tee "${LATTICE_OUTPUT_FILE}"; then
  fatal "lattice agent session failed"
fi

# Extract usage and cost from the JSONL output.
# Prefer the run-complete event (emitted at end of --json run) which has aggregated
# totals. Fall back to summing usage-delta + session-usage-delta events when
# run-complete is missing (e.g. process killed by timeout, stdout not flushed).
python3 -c '
import json, sys
result = {"input": 0, "output": 0, "cost_usd": None}
# Track cumulative usage from usage-delta events (keyed by messageId).
# Each usage-delta contains cumulative totals for its message, so we keep the
# latest per message and sum across messages at the end.
cumulative_by_msg = {}
# Track sub-agent usage from session-usage-delta events. These carry per-model
# byModelDelta dicts with {input: {tokens, cost_usd}, output: {tokens, cost_usd}, ...}.
# Each event is an incremental delta, so we sum them all.
subagent_input = 0
subagent_output = 0
for line in open(sys.argv[1]):
    try:
        obj = json.loads(line)
        if obj.get("type") == "run-complete":
            usage = obj.get("usage") or {}
            result["input"] = usage.get("inputTokens", 0) or 0
            result["output"] = usage.get("outputTokens", 0) or 0
            result["cost_usd"] = obj.get("cost_usd")
            print(json.dumps(result))
            sys.exit(0)
        # Nested event wrapper: {"type":"event","payload":{"type":"usage-delta",...}}
        payload = obj.get("payload") or obj
        if payload.get("type") == "usage-delta":
            msg_id = payload.get("messageId", "")
            # Prefer cumulativeUsage (running total across all steps in a message)
            # over usage (per-step delta). Keeping the latest cumulative per message
            # gives the correct total when summed across messages.
            usage = payload.get("cumulativeUsage") or payload.get("usage") or {}
            cumulative_by_msg[msg_id] = usage
        elif payload.get("type") == "session-usage-delta":
            for model_usage in (payload.get("byModelDelta") or {}).values():
                subagent_input += (model_usage.get("input") or {}).get("tokens", 0)
                subagent_output += (model_usage.get("output") or {}).get("tokens", 0)
    except Exception:
        pass
# No run-complete found — aggregate the last usage-delta per message + sub-agent totals
for usage in cumulative_by_msg.values():
    result["input"] += (usage.get("inputTokens", 0) or 0)
    result["output"] += (usage.get("outputTokens", 0) or 0)
result["input"] += subagent_input
result["output"] += subagent_output
print(json.dumps(result))
' "${LATTICE_OUTPUT_FILE}" > "${LATTICE_TOKEN_FILE}" 2>/dev/null || true
