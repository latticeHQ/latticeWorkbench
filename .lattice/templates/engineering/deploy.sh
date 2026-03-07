#!/usr/bin/env bash
# Deploy the Engineering Department Template
# Usage: .lattice/templates/engineering/deploy.sh <project-path>
#
# This script uses the Lattice MCP tools to deploy the Engineering department:
# 1. Creates the 10 pipeline stages (Intake → Discovery → ... → Learning)
# 2. Creates 11 minions (1 Chief of Staff + 10 stage agents)
# 3. Sets up scheduled jobs (morning briefing, nightly build, weekly retro, cost report)
#
# Prerequisites:
# - Lattice Workbench running
# - Project registered in Lattice

set -euo pipefail

PROJECT_PATH="${1:?Usage: deploy.sh <project-path>}"

echo "=== Deploying Engineering Department ==="
echo "Project: $PROJECT_PATH"
echo ""

# Verify project exists
echo "[1/4] Verifying project..."
if ! lattice project list | grep -q "$PROJECT_PATH"; then
  echo "  Project not registered. Registering..."
  lattice project create "$PROJECT_PATH"
fi
echo "  OK"

# Create minions for each stage agent
echo ""
echo "[2/4] Deploying minions..."

MINIONS=(
  "chief-of-staff:Chief of Staff - Cross-stage coordinator"
  "intake:Intake - Triage incoming issues"
  "discovery:Discovery - Research and spikes"
  "planning:Planning - Architecture and task breakdown"
  "build:Build - Feature implementation"
  "test:Test - Testing and quality"
  "review:Review - Code review and security"
  "docs:Docs - Documentation"
  "deploy:Deploy - CI/CD and releases"
  "monitor:Monitor - Monitoring and incidents"
  "learning:Learning - Retrospectives and improvement"
)

for entry in "${MINIONS[@]}"; do
  BRANCH="${entry%%:*}"
  TITLE="${entry#*:}"
  echo "  Deploying: $TITLE"
  lattice minion create \
    --project "$PROJECT_PATH" \
    --branch "eng/$BRANCH" \
    --title "$TITLE" \
    --trunk main \
    2>/dev/null || echo "    (already exists, skipping)"
done

echo "  11 minions deployed"

# Set up scheduled jobs
echo ""
echo "[3/4] Setting up schedules..."

# Morning Briefing - 8 AM daily
echo "  Morning Briefing (8 AM daily)"
lattice schedule create \
  --project "$PROJECT_PATH" \
  --name "Morning Briefing" \
  --minion "eng/chief-of-staff" \
  --cron "0 8 * * *" \
  --prompt "Compile the morning briefing. Review overnight progress across all stages. Summarize: what shipped, what's blocked, what needs attention today. Recommend priorities for the day." \
  2>/dev/null || echo "    (already exists, skipping)"

# Nightly Build Check - 2 AM daily
echo "  Nightly Build Check (2 AM daily)"
lattice schedule create \
  --project "$PROJECT_PATH" \
  --name "Nightly Build Check" \
  --minion "eng/deploy" \
  --cron "0 2 * * *" \
  --prompt "Run the nightly build. Check that all platforms build successfully. Report any failures to the Chief of Staff." \
  2>/dev/null || echo "    (already exists, skipping)"

# Weekly Retrospective - 4 PM every Friday
echo "  Weekly Retrospective (Fridays 4 PM)"
lattice schedule create \
  --project "$PROJECT_PATH" \
  --name "Weekly Retrospective" \
  --minion "eng/learning" \
  --cron "0 16 * * 5" \
  --prompt "Conduct the weekly retrospective. Review the pipeline: bottlenecks, overloaded stages, idle stages. Analyze cycle time, defect rate, and review turnaround. Propose improvements." \
  2>/dev/null || echo "    (already exists, skipping)"

# Weekly Cost Report - 9 AM every Monday
echo "  Weekly Cost Report (Mondays 9 AM)"
lattice schedule create \
  --project "$PROJECT_PATH" \
  --name "Weekly Cost Report" \
  --minion "eng/monitor" \
  --cron "0 9 * * 1" \
  --prompt "Generate the weekly cost report. Track API costs and token usage across all minions. Flag unexpected spikes. Report to Chief of Staff." \
  2>/dev/null || echo "    (already exists, skipping)"

echo "  4 schedules configured"

# Summary
echo ""
echo "[4/4] Done!"
echo ""
echo "=== Engineering Department Deployed ==="
echo ""
echo "  Minions:    11 (1 Chief of Staff + 10 stage agents)"
echo "  Pipeline:   Intake → Discovery → Planning → Build → Test → Review → Docs → Deploy → Monitor → Learning"
echo "  Schedules:  Morning Briefing (daily 8AM), Nightly Build (daily 2AM),"
echo "              Weekly Retro (Fri 4PM), Cost Report (Mon 9AM)"
echo ""
echo "  Chat with your Chief of Staff to get started."
echo ""
