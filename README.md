<div align="center">

# Lattice Workbench

### Your Agency Headquarters — Part of the [Lattice Ecosystem](./PREAMBLE.md)

**Summon minions. Organize crews. Run missions. One tool.**

[![Latest Release](https://img.shields.io/github/v/release/latticeHQ/latticeWorkbench?style=flat-square&label=latest)](https://github.com/latticeHQ/latticeWorkbench/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

> Lattice is the open-source platform for building your personal team of AI agents.
> Read the **[Preamble](./PREAMBLE.md)** for the full vision, vocabulary, and ecosystem architecture.

## The Lattice Ecosystem

| Component | Role | Repository |
| --- | --- | --- |
| [**Runtime**](https://github.com/latticeHQ/lattice) | Enforcement kernel — identity, authorization, audit, deployment constraints | [latticeRuntime](https://github.com/latticeHQ/lattice) |
| [**Inference**](https://github.com/latticeHQ/lattice-inference) | Local LLM serving — MLX, CUDA, zero-config clustering, OpenAI-compatible API | [latticeInference](https://github.com/latticeHQ/lattice-inference) |
| **Workbench** (this repo) | Agency headquarters — summon minions, manage crews, monitor missions | You are here |
| [**Registry**](https://github.com/latticeHQ/lattice-registry) | Community ecosystem — templates, modules, presets for Docker/K8s/AWS/GCP/Azure | [latticeRegistry](https://github.com/latticeHQ/lattice-registry) |

## Download

**[→ Latest Release](https://github.com/latticeHQ/latticeWorkbench/releases/latest)**

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

### Mission Control — Your Crew at a Glance

Mission Control is the top-level view of everything happening across your minion roster, organized into four tabs:

- **Agent Net** — Live pipeline canvas showing all active missions as nodes. Connections animate during tool calls. Costs and token usage roll up per minion, per crew, and across the entire project in real time.
- **New Mission** — Guided wizard for summoning a new minion: pick runtime mode, select model, choose agent type, configure MCP tools, and launch.
- **MCP Servers** — Visual management of all Model Context Protocol servers for the project. Enable/disable, inspect tools, test connections.
- **Bench** — Browse and restore minions between missions.

### For Building Minions

- **Multi-model support**: Claude, GPT, Gemini, Grok, Deepseek, Ollama, OpenRouter, Lattice Inference — any provider, swap freely
- **Minion isolation**: Each minion gets its own environment with a separate git branch, runtime, and conversation history
- **Plan/Exec modes**: Strategic planning phase (analysis only) and execution phase (tool use) — the way minions should work in production
- **Built-in agent types**: Pre-configured agents for execution, planning, exploration, and context management
- **MCP tools**: Model Context Protocol support for extensible tool discovery and execution
- **Document ingestion**: Analyze PDF, DOCX, XLSX, PPTX files directly in conversations
- **Rich output**: Mermaid diagrams, LaTeX, syntax-highlighted code, streaming markdown
- **vim keybindings**: For those who know

### For Operating Your Crew

- **Live pipeline canvas**: Visual graph of all running missions with animated connections and live status indicators
- **Real-time cost tracking**: Token usage and spend roll up per minion, per crew, and across the whole project — updated as missions run
- **Conversation history** and tool execution replay
- **Minion configuration** and permission management
- **Git divergence visualization** for minion-level code review

### Runtime Modes

| Mode | Description |
| --- | --- |
| **Local** | Direct execution in your project directory |
| **Git Worktree** | Isolated branch-based development |
| **SSH** | Remote execution on any server |
| **Docker** | Container-based sandboxed execution |

### Platforms

- **Desktop**: macOS, Windows, Linux (Electron)
- **Web**: Server mode accessible from any browser
- **CLI**: Command-line interface for scripting and automation
- **VS Code Extension**: Jump into your minions from VS Code

## How It Works with the Ecosystem

### With Lattice Runtime

Workbench connects to Runtime via oRPC (WebSocket + HTTP). Minions summoned in Workbench are governed by Runtime's four enforcement gates — identity, authorization, audit, and deployment constraints. Mission Control provides real-time monitoring of Runtime's audit stream.

### With Lattice Inference

Use local models alongside cloud providers. Lattice Inference provides an OpenAI-compatible API at `localhost:8000` — Workbench treats it like any other provider. Zero API costs. Zero data leakage. Switch between local and cloud models with one click.

### With Lattice Registry

Deploy minions from Workbench using Registry templates. One command gives you a governed minion environment on Docker, Kubernetes, AWS, GCP, or Azure — with identity and audit built in.

## Development

See [AGENTS.md](./AGENTS.md) for development setup and guidelines.

See [BUILD_REFERENCE.md](./BUILD_REFERENCE.md) for build system documentation.

## License

Lattice Workbench is licensed under [MIT](./LICENSE).

---

<div align="center">

**[Lattice — Your Agency Headquarters](https://latticeruntime.com)**

Your minions. Your models. Your rules. Your infrastructure.

`brew install latticehq/lattice/lattice`

</div>
