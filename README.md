<div align="center">

# Lattice Workbench

### The Interface of [Lattice — Agent Headquarters](https://latticeruntime.com)

**Build agents. Test agents. Monitor agents. One tool.**

[![Latest Release](https://img.shields.io/github/v/release/latticeHQ/latticeWorkbench?style=flat-square&label=latest)](https://github.com/latticeHQ/latticeWorkbench/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

## Part of the Lattice Ecosystem

Lattice is **Agent Headquarters** — the open-source runtime where AI agents get their identity, their permissions, their compute, and their orders. Lattice Workbench is the agent development and operations console.

| Component                                                       | Role                                                                           | Repository                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [**Runtime**](https://github.com/latticeHQ/lattice)             | Enforcement kernel — identity, authorization, audit, deployment constraints    | [latticeRuntime](https://github.com/latticeHQ/lattice)             |
| [**Inference**](https://github.com/latticeHQ/lattice-inference) | Local LLM serving — MLX, CUDA, zero-config clustering, OpenAI-compatible API   | [latticeInference](https://github.com/latticeHQ/lattice-inference) |
| **Workbench** (this repo)                                       | Agent IDE & operations console — multi-model chat, monitoring, desktop/web/CLI | You are here                                                       |
| [**Registry**](https://github.com/latticeHQ/lattice-registry)   | Community ecosystem — templates, modules, presets for Docker/K8s/AWS/GCP/Azure | [latticeRegistry](https://github.com/latticeHQ/lattice-registry)   |

<div align="center">
  <img src="docs/img/lattice-headquarters.png" alt="Lattice: The Open-Source Headquarters for AI Agent Governance" width="100%" />
</div>

## Download

**[→ Latest Release: v0.1.1](https://github.com/latticeHQ/latticeWorkbench/releases/latest)**

| Platform | Architecture | Installer |
| -------- | ------------ | --------- |
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x64) | `.dmg` |
| Windows | arm64 | `.exe` |
| Windows | x64 | `.exe` |
| Linux | arm64 | `.AppImage` |
| Linux | x86_64 | `.AppImage` |

All installers are available on the [Releases page](https://github.com/latticeHQ/latticeWorkbench/releases).

Or install via Homebrew (macOS / Linux):

```bash
brew install latticehq/lattice/lattice
```

## Features

### Project HQ — Your Agent Command Center

The Project HQ is the top-level view of everything happening across your agent fleet, organized into four tabs:

- **Agent Net** — Live pipeline canvas showing all agent missions as nodes. Connections animate during active tool calls. Costs and token usage roll up per stage, per phase, and across the entire project in real time.
- **New Mission** — Guided wizard for spinning up new agent workspaces: pick runtime mode, select model, choose agent type, configure MCP tools, and launch.
- **MCP Servers** — Visual management of all Model Context Protocol servers for the project. Enable/disable, inspect tools, test connections.
- **Archived** — Browse and restore completed or archived workspaces.

### For Building Agents

- **Multi-model support**: Claude, GPT, Gemini, Grok, Deepseek, Ollama, OpenRouter, Lattice Inference — any provider, swap freely
- **Workspace isolation**: Each agent gets its own workspace with separate git branch, runtime environment, and conversation history
- **Plan/Exec modes**: Strategic planning phase (analysis only) and execution phase (tool use) — the way agents should work in production
- **Built-in agents**: Pre-configured agents for execution, planning, exploration, and context management
- **MCP tools**: Model Context Protocol support for extensible tool discovery and execution
- **Document ingestion**: Analyze PDF, DOCX, XLSX, PPTX files directly in conversations
- **Rich output**: Mermaid diagrams, LaTeX, syntax-highlighted code, streaming markdown
- **vim keybindings**: For those who know

### For Operating Agents

- **Live pipeline canvas**: Visual graph of all running missions with animated connections and live status indicators
- **Real-time cost tracking**: Token usage and spend roll up per stage, per pipeline phase, and across the whole project — updated as agents run
- **Conversation history** and tool execution replay
- **Agent configuration** and permission management
- **Git divergence visualization** for workspace-level code review

### Runtime Modes

| Mode             | Description                                |
| ---------------- | ------------------------------------------ |
| **Local**        | Direct execution in your project directory |
| **Git Worktree** | Isolated branch-based development          |
| **SSH**          | Remote execution on any server             |
| **Docker**       | Container-based sandboxed execution        |

### Platforms

- **Desktop**: macOS, Windows, Linux (Electron)
- **Web**: Server mode accessible from any browser
- **CLI**: Command-line interface for scripting and automation
- **VS Code Extension**: Jump into Lattice workspaces from VS Code

## How It Works with the Ecosystem

### With Lattice Runtime

Workbench connects to Runtime via oRPC (WebSocket + HTTP). Agents built and tested in Workbench are governed by Runtime's four enforcement gates — identity, authorization, audit, and deployment constraints. The operations console provides real-time monitoring of Runtime's audit stream.

### With Lattice Inference

Use local models alongside cloud providers. Lattice Inference provides an OpenAI-compatible API at `localhost:8000` — Workbench treats it like any other provider. Zero API costs. Zero data leakage. Switch between local and cloud models with one click.

### With Lattice Registry

Deploy agents from Workbench using Registry templates. One command gives you a governed agent environment on Docker, Kubernetes, AWS, GCP, or Azure — with identity and audit built in.

## Development

See [AGENTS.md](./AGENTS.md) for development setup and guidelines.

See [BUILD_REFERENCE.md](./BUILD_REFERENCE.md) for build system documentation.

## License

Lattice Workbench is licensed under [MIT](./LICENSE).

---

<div align="center">

**[Lattice — Agent Headquarters](https://latticeruntime.com)**

Your agents. Your models. Your rules. Your infrastructure.

`brew install latticehq/lattice/lattice`

</div>
