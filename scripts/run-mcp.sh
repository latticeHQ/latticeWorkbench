#!/bin/bash
# MCP server launcher — ensures PATH includes volta and bun
export PATH="/Users/onchainengineer/.volta/bin:/Users/onchainengineer/.bun/bin:$PATH"
cd /Users/onchainengineer/workspace/sandbox/claude-code/agentHQ/latticeWorkbench
exec npx tsx src/mcp-server/index.ts "$@"
