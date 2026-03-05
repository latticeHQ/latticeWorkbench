> **Work in Progress** — First stable release targeted for **March 31, 2026**. Current releases are incomplete builds. The agents are building this themselves — even while we sleep. Star and watch this repo to follow along.

<div align="center">

# Lattice

### From idea to company. One command.

**Your entire company. On a Mac (Cluster).**

[![Latest Release](https://img.shields.io/github/v/release/latticeHQ/latticeWorkbench?style=flat-square&label=latest)](https://github.com/latticeHQ/latticeWorkbench/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

> Lattice is the open-source platform for deploying companies powered by AI workforces.
> Read the **[Preamble](./PREAMBLE.md)** for the full vision and architecture.

---

## What Is Lattice?

A company is a set of departments, roles, and decisions organized toward a goal. Lattice lets you deploy one with a single command.

You describe the company you want to build. Lattice deploys it — engineering, marketing, sales, support, finance — each department running as an isolated, autonomous unit on your own hardware. Each department has its own workspace, its own minions, its own tools, its own schedule, its own budget.

The founder is the CEO. Lattice is the company.

---

## What It Feels Like

You open your Mac in the morning. Your Chief of Staff has already compiled the overnight briefing. Engineering shipped two features and opened PRs. Marketing published a blog post and scheduled social content. Sales qualified three inbound leads. Support resolved twelve tickets. Finance updated the weekly cash flow report.

You review. You redirect. You decide. The company executes.

---

## The Lattice Ecosystem

| Component | Role | Repository |
| --- | --- | --- |
| [**Runtime**](https://github.com/latticeHQ/lattice) | Enforcement backbone — identity, authorization, audit, budget constraints, cross-department coordination | [latticeRuntime](https://github.com/latticeHQ/lattice) |
| [**Inference**](https://github.com/latticeHQ/lattice-inference) | Local AI on your hardware — MLX on Apple Silicon, zero-config clustering, zero API costs | [latticeInference](https://github.com/latticeHQ/lattice-inference) |
| **Workbench** (this repo) | Department workspace — each department gets its own instance with minions, tools, schedules, and chat history | You are here |
| [**Registry**](https://github.com/latticeHQ/lattice-registry) | Community ecosystem — company templates, department templates, infrastructure presets | [latticeRegistry](https://github.com/latticeHQ/lattice-registry) |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Your Hardware                       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            LATTICE RUNTIME                     │  │
│  │                                                │  │
│  │  Identity · Authorization · Constraints · Audit│  │
│  │  Cross-department coordination                 │  │
│  │  Budget management & cost tracking             │  │
│  └──────────┬─────────┬─────────┬────────────────┘  │
│             │         │         │                    │
│       ┌─────▼──┐ ┌────▼───┐ ┌──▼──────┐            │
│       │  Eng   │ │ Mktg   │ │ Sales   │  ...        │
│       │  ════  │ │  ════  │ │  ════   │             │
│       │Workbnch│ │Workbnch│ │Workbnch │             │
│       │Instance│ │Instance│ │Instance │             │
│       └────────┘ └────────┘ └─────────┘             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │          LATTICE INFERENCE                     │  │
│  │  Local AI models on Apple Silicon              │  │
│  │  Zero API costs · Zero data leakage            │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Runtime** deploys departments, enforces policies, coordinates communication, tracks costs. Written in Go.

**Workbench** is each department's workspace. One instance per department — isolated minions, tools, schedules, and history. Written in TypeScript/React.

**Inference** runs AI models locally on your hardware. Routine tasks cost nothing. Your data never leaves your machine.

---

## How Departments Work

Each department is a Workbench instance with a built-in delivery pipeline:

```
Intake → Discovery → Planning → Build → Test → Review → Docs → Deploy → Monitor → Learning
```

Each crew has a lead minion. Leads can spawn more minions into their crew as needed.

| Crew | Lead | What They Do |
| --- | --- | --- |
| **Intake** | Intake Lead | Triage incoming issues, feature requests, bug reports |
| **Discovery** | Discovery Lead | Research, spikes, understand the problem space |
| **Planning** | Planning Lead | Sprint planning, architecture, task breakdown |
| **Build** | Build Lead | Feature implementation, bug fixes |
| **Test** | Test Lead | Test plans, regression testing, coverage |
| **Review** | Review Lead | PR review, quality gates, security checks |
| **Docs** | Docs Lead | Documentation, changelogs, API docs |
| **Deploy** | Deploy Lead | CI/CD, releases, deployment pipelines |
| **Monitor** | Monitor Lead | Production monitoring, alerts, health checks |
| **Learning** | Learning Lead | Retrospectives, post-mortems, knowledge capture |

A **Chief of Staff** coordinates across all crews — daily briefings, task routing, escalation. When you chat with Lattice, you're talking to your CoS.

Minions work autonomously. They pick up tasks, execute, coordinate, and report back. You check in when you want — not when the system demands it.

---

## Features

### For Running Your Company

- **Department isolation**: Each department gets its own Workbench instance — separate minions, tools, budgets, and history
- **Pipeline canvas**: Live visual graph of all active work with animated connections and real-time status
- **Cost tracking**: Token usage and spend roll up per minion, per department, and across the whole company
- **Scheduled operations**: Cron and interval-based jobs — morning briefings, nightly builds, weekly reports
- **Cross-department coordination**: Runtime orchestrates communication and escalation between departments

### For Building Minions

- **Multi-model support**: Claude, GPT, Gemini, Grok, Deepseek, Ollama, OpenRouter, Lattice Inference — any provider, swap freely
- **Minion isolation**: Each minion gets its own environment with a separate git branch, runtime, and conversation history
- **Plan/Exec modes**: Strategic planning phase (analysis only) and execution phase (tool use)
- **Built-in agent types**: Pre-configured agents for execution, planning, exploration, and coordination
- **MCP tools**: Model Context Protocol support for extensible tool discovery and execution
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

### Deploy the Engineering Department

The fastest way to start is deploying the Engineering department template. It comes with a Chief of Staff + 10 crew leads across a full delivery pipeline — ready to build software autonomously. Each lead can spawn more minions as needed.

```bash
# Install Lattice
brew install latticehq/lattice/lattice

# Deploy the Engineering department
lattice deploy --template engineering
```

Your Engineering department comes online with minions assigned to pipeline stages: Intake, Discovery, Planning, Build, Test, Review, Docs, Deploy, Monitor, Learning. Give them a task — they take it from there.

### What Happens Next

Use it. Watch what's missing. Add departments based on real needs:

- Need to spread the word? → Deploy Marketing
- Getting inbound interest? → Deploy Sales
- Users showing up? → Deploy Support
- Need structured specs? → Deploy Product
- Need to track money? → Deploy Finance

Each department earns its place through necessity.

---

## The Vocabulary

| Term | What It Means |
| --- | --- |
| **Minion** | An AI worker on your roster. It has an identity, a runtime, a conversation history, and work to do. |
| **Department** | A business unit — Engineering, Marketing, Sales. Each runs as its own Workbench instance. |
| **Crew** | A pipeline stage within a department — Intake, Build, Review, Deploy. Organizes how work flows. |
| **Founder** | The human. The CEO. The one who deploys and directs. |

---

## How It Works with the Ecosystem

### With Lattice Runtime

Workbench connects to Runtime via oRPC (WebSocket + HTTP). Every minion passes through Runtime's four enforcement gates — identity, authorization, audit, and deployment constraints. Runtime coordinates across departments and tracks company-wide costs.

### With Lattice Inference

Run local models alongside cloud providers. Lattice Inference serves an OpenAI-compatible API on your hardware — zero API costs, zero data leakage. Switch between local and cloud models with one click.

### With Lattice Registry

Deploy departments from community templates. One command gives you a governed department with the right minions, tools, schedules, and pipeline configuration.

---

## Development

See [AGENTS.md](./AGENTS.md) for development setup and guidelines.

See [BUILD_REFERENCE.md](./BUILD_REFERENCE.md) for build system documentation.

## License

Lattice is licensed under [MIT](./LICENSE).

---

<div align="center">

**[Lattice — From idea to company. One command.](https://latticeruntime.com)**

Deploy your company. Your minions. Your models. Your hardware.

```
brew install latticehq/lattice/lattice
```

</div>
