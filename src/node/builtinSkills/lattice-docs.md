---
name: lattice-docs
description: Guide for answering questions about Lattice Workbench using the live documentation.
---

# lattice docs

This built-in skill helps the agent answer questions about **Lattice** (Lattice Workbench).

## How to use

Fetch the live docs at **https://latticeruntime.com** using `web_fetch`:

```ts
web_fetch({ url: "https://latticeruntime.com/config/models" });
web_fetch({ url: "https://latticeruntime.com/agents" });
```

### Key doc routes

| Topic | URL |
|---|---|
| Introduction | `https://latticeruntime.com/` |
| Install | `https://latticeruntime.com/install` |
| Models | `https://latticeruntime.com/config/models` |
| Providers | `https://latticeruntime.com/config/providers` |
| Minions | `https://latticeruntime.com/minions` |
| Compaction | `https://latticeruntime.com/minions/compaction` |
| Runtimes | `https://latticeruntime.com/runtime` |
| Agents | `https://latticeruntime.com/agents` |
| Agent Skills | `https://latticeruntime.com/agents/agent-skills` |
| Instruction Files | `https://latticeruntime.com/agents/instruction-files` |
| Plan Mode | `https://latticeruntime.com/agents/plan-mode` |
| MCP Servers | `https://latticeruntime.com/config/mcp-servers` |
| Hooks (Init) | `https://latticeruntime.com/hooks/init` |
| Hooks (Tools) | `https://latticeruntime.com/hooks/tools` |
| Policy File | `https://latticeruntime.com/config/policy-file` |
| Project Secrets | `https://latticeruntime.com/config/project-secrets` |
| Keyboard Shortcuts | `https://latticeruntime.com/config/keybinds` |
| VS Code Extension | `https://latticeruntime.com/integrations/vscode-extension` |
| GitHub Actions | `https://latticeruntime.com/guides/github-actions` |
| CLI Reference | `https://latticeruntime.com/reference/cli` |
| Telemetry | `https://latticeruntime.com/reference/telemetry` |
| Lattice Governor | `https://latticeruntime.com/integrations/lattice-governor` |

## When to use

Use this skill when the user asks how Lattice works (minions, runtimes, agents, models, hooks, keybinds, etc.).

## Links

- **GitHub**: https://github.com/latticeHQ/latticeWorkbench
- **Documentation**: https://latticeruntime.com
