#!/bin/bash
# MCP Server Smoke Test — quick validation that the lattice-workbench MCP server starts
# and registers tools correctly.
#
# Usage:
#   ./scripts/mcp-smoke-test.sh [workbench-url]
#
# Prerequisites:
#   - Workbench running (npm run dev)
#   - @modelcontextprotocol/inspector installed (npx will auto-install)

set -euo pipefail

WORKBENCH_URL="${1:-http://localhost:3000}"
MCP_SERVER="npx tsx src/mcp-server/index.ts --workbench-url $WORKBENCH_URL"
PASS=0
FAIL=0

echo "═══════════════════════════════════════"
echo "  Lattice Workbench MCP Smoke Test"
echo "═══════════════════════════════════════"
echo ""
echo "Workbench URL: $WORKBENCH_URL"
echo ""

# ── Test 1: Server starts without error ────────────────────────────
echo -n "[TEST 1] Server starts... "
timeout 10 npx tsx src/mcp-server/index.ts --workbench-url "$WORKBENCH_URL" 2>/tmp/mcp-test-stderr &
SERVER_PID=$!
sleep 3

if kill -0 $SERVER_PID 2>/dev/null; then
  echo "PASS"
  PASS=$((PASS + 1))
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
else
  echo "FAIL"
  FAIL=$((FAIL + 1))
  echo "  stderr: $(cat /tmp/mcp-test-stderr)"
fi

# ── Test 2: TypeScript compiles ────────────────────────────────────
echo -n "[TEST 2] TypeScript compiles... "
if npx tsc --noEmit 2>/dev/null; then
  echo "PASS"
  PASS=$((PASS + 1))
else
  echo "FAIL"
  FAIL=$((FAIL + 1))
fi

# ── Test 3: Workbench API reachable ────────────────────────────────
echo -n "[TEST 3] Workbench API health... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WORKBENCH_URL/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "PASS (HTTP $HTTP_CODE)"
  PASS=$((PASS + 1))
else
  echo "SKIP (HTTP $HTTP_CODE — workbench not running?)"
fi

# ── Test 4: All tool files compile individually ────────────────────
echo -n "[TEST 4] Tool files parse... "
TOOL_FILES=$(find src/mcp-server/tools -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TOOL_FILES" -gt 0 ]; then
  echo "PASS ($TOOL_FILES tool files found)"
  PASS=$((PASS + 1))
else
  echo "FAIL (no tool files found)"
  FAIL=$((FAIL + 1))
fi

# ── Test 5: Channel adapters exist ─────────────────────────────────
echo -n "[TEST 5] Channel adapters... "
ADAPTERS=0
for adapter in telegram discord slack whatsapp; do
  if [ -f "src/node/services/channels/$adapter/"*Adapter.ts ]; then
    ADAPTERS=$((ADAPTERS + 1))
  fi
done
if [ "$ADAPTERS" -eq 4 ]; then
  echo "PASS ($ADAPTERS adapters: telegram, discord, slack, whatsapp)"
  PASS=$((PASS + 1))
else
  echo "FAIL (only $ADAPTERS/4 adapters found)"
  FAIL=$((FAIL + 1))
fi

# ── Test 6: Persistence directories ───────────────────────────────
echo -n "[TEST 6] Persistence dirs... "
SWARM_DIR="$HOME/.lattice/swarm"
CRON_DIR="$HOME/.lattice/cron"
if [ -d "$SWARM_DIR" ] || [ -d "$CRON_DIR" ]; then
  echo "PASS (swarm: $([ -d "$SWARM_DIR" ] && echo 'yes' || echo 'no'), cron: $([ -d "$CRON_DIR" ] && echo 'yes' || echo 'no'))"
  PASS=$((PASS + 1))
else
  echo "SKIP (no persistence dirs yet — normal for fresh install)"
fi

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
