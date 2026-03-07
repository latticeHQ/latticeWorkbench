> **Work in Progress** — First stable release targeted for **March 31, 2026**. Current releases are incomplete builds. Star and watch this repo to follow along.

<div align="center">

# Lattice Workbench

### Multi-model AI agent workbench

**Run a team of AI specialists on your hardware.**

[![Latest Release](https://img.shields.io/github/v/release/latticeHQ/latticeWorkbench?style=flat-square&label=latest)](https://github.com/latticeHQ/latticeWorkbench/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

> Read the **[Preamble](./PREAMBLE.md)** for the founding vision and philosophy.

---

## What Is Lattice Workbench?

A workbench for running multiple AI agents in parallel. Each agent (called a **minion**) gets its own git worktree, conversation history, and tool access. Organize them into pipeline stages. Let them spawn child agents for parallel work.

---

## Features

### Agents

- **Minion isolation**: Each minion gets its own git worktree, runtime, and conversation history
- **Multi-model support**: Claude, GPT, Gemini, Grok, Deepseek, Ollama, OpenRouter, Lattice Inference — any provider, swap freely
- **Built-in agent types**: Pre-configured exec, plan, explore, and orchestrator agents with distinct tool policies
- **Sidekick spawning**: Minions spawn child minions for parallel work — each with its own worktree
- **Agent definitions**: Markdown files with frontmatter configure agent behavior, base type, and prompts
- **Plan/Exec modes**: Strategic planning phase (analysis only) and execution phase (tool use)

### Organization

- **Stages**: Pipeline stages (Intake, Build, Review, Deploy, etc.) for organizing minions visually
- **Scheduling**: Cron-based jobs — morning briefings, nightly builds, weekly reports
- **Cost tracking**: Token usage and API spend per minion

### Tools

- **MCP tools**: 170+ functions for minion management, project CRUD, browser automation, and more
- **Document ingestion**: Analyze PDF, DOCX, XLSX, PPTX files directly in conversations
- **Rich output**: Mermaid diagrams, LaTeX, syntax-highlighted code, streaming markdown

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

---

## Download

**[Latest Release](https://github.com/latticeHQ/latticeWorkbench/releases/latest)**

| Platform | Architecture | Installer |
| -------- | ------------ | --------- |
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x64) | `.dmg` |
| Windows | arm64 | `.exe` |
| Windows | x64 | `.exe` |
| Linux | arm64 | `.AppImage` |
| Linux | x86_64 | `.AppImage` |

Or install via Homebrew (macOS / Linux):

```bash
brew install latticehq/lattice/lattice
```

---

## Getting Started

1. Install Lattice Workbench (download or `brew install`)
2. Open Lattice and create a project pointing at your repo
3. Create minions — each gets its own git worktree
4. Organize them into stages if you want pipeline-style organization
5. Set up scheduled jobs for recurring tasks (optional)

### Agent Definitions

Lattice ships with agent definitions for a 10-stage software delivery pipeline in `.lattice/agents/`:

| Agent | Purpose |
| --- | --- |
| `intake.md` | Triage incoming issues and bug reports |
| `discovery.md` | Research and technical spikes |
| `planning.md` | Architecture decisions, task breakdown |
| `build.md` | Feature implementation, bug fixes |
| `test.md` | Test plans, regression testing |
| `review.md` | Code review, security checks |
| `docs.md` | Documentation and changelogs |
| `deploy.md` | CI/CD, releases |
| `monitor.md` | Production monitoring, alerts |
| `learning.md` | Retrospectives, process improvement |

Plus `chief-of-staff.md` (orchestrator), `exec.md`, and `plan.md`.

---

## The Vocabulary

| Term | What It Means |
| --- | --- |
| **Minion** | An AI agent with its own git worktree, conversation history, and tools. |
| **Stage** | A pipeline stage for organizing minions visually — Intake, Build, Review, Deploy, etc. |
| **Sidekick** | A child minion spawned by another minion for parallel work. |

---

## Ecosystem

| Component | What It Does | License |
| --- | --- | --- |
| **Workbench** (this repo) | AI agent workbench — minions, stages, scheduling, multi-model chat | MIT |
| [**Inference**](https://github.com/latticeHQ/lattice-inference) | Local AI serving — MLX on Apple Silicon, zero-config clustering | Apache 2.0 |
| [**Runtime**](https://github.com/latticeHQ/lattice) | Identity, authorization, audit, deployment constraints | Apache 2.0 |

---

## Development

See [AGENTS.md](./AGENTS.md) for development setup and guidelines.

## License

Lattice is licensed under [MIT](./LICENSE).

---

<div align="center">

**[latticeruntime.com](https://latticeruntime.com)**

</div>
