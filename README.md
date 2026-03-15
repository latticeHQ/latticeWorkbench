<div align="center">

# Lattice Workbench

### The Reference Engineering Stack for Lattice Runtime

[![Latest Release](https://img.shields.io/github/v/release/latticeHQ/latticeWorkbench?style=flat-square&label=latest)](https://github.com/latticeHQ/latticeWorkbench/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)

**Run a team of AI specialists on your hardware — governed by [Lattice Runtime](https://github.com/latticeHQ/latticeRuntime).**

[Download](https://github.com/latticeHQ/latticeWorkbench/releases/latest) · [Preamble](./PREAMBLE.md) · [Discussions](https://github.com/latticeHQ/latticeRuntime/discussions)

</div>

---

**Work in Progress** — First stable release targeted for **March 31, 2026**. Star and watch to follow along.

---

## Why Workbench Exists

[Lattice Runtime](https://github.com/latticeHQ/latticeRuntime) is the open-source coordination layer for institutional AI — identity, authorization, audit, and budget for every agent in the organization. But a coordination layer alone is not useful. Departments need applications built on top of it.

**Department Stacks** are vertical applications that inherit Runtime's governance and add domain-specific agent workflows. Workbench is the **first stack** — purpose-built for software engineering teams.

This repo serves two purposes:

1. **A production tool for engineering teams.** Workbench gives every developer a governed team of AI agents — each with its own git worktree, conversation history, and tool access — organized into pipeline stages that mirror how software actually ships.

2. **A reference implementation for stack developers.** If you're building a stack for a different domain — clinical, legal, finance, support — study this codebase. It demonstrates how stacks connect to Runtime, inherit governance, and add domain-specific agent behavior. See the [Stack SDK guide](https://github.com/latticeHQ/latticeRuntime/blob/develop/docs/stacks/README.md).

> Read the **[Preamble](./PREAMBLE.md)** for the founding vision and philosophy.

## What It Does

Workbench organizes AI agents (called **minions**) into a software delivery pipeline. Each minion gets its own isolated execution environment, its own conversation history, and its own tool access. Organize them into stages. Let them spawn child agents for parallel work. Connect to Runtime for institutional governance — or run standalone for local development.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LATTICE WORKBENCH                                      │
│                  Engineering Stack on Runtime                                │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │  Intake  │ │  Build   │ │  Review  │ │  Deploy  │ │ Monitor  │  ...      │
│  │──────────│ │──────────│ │──────────│ │──────────│ │──────────│          │
│  │ Triage   │ │ Feature  │ │ Code Rev │ │ CI/CD    │ │ Alerts   │          │
│  │ Classify │ │ Bug Fix  │ │ Security │ │ Release  │ │ Health   │          │
│  │ Assign   │ │ Refactor │ │ Approve  │ │ Rollback │ │ Respond  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                             │
│  Each minion: own git worktree · own conversation · own tools · governed    │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Inherits from Runtime: Identity · Auth · Budget · Audit · Networking │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Agents

- **Minion isolation**: Each minion gets its own git worktree, runtime, and conversation history — no cross-contamination between agents
- **Multi-model support**: Claude, GPT, Gemini, Grok, Deepseek, Ollama, OpenRouter, Lattice Inference — any provider, swap freely
- **Built-in agent types**: Pre-configured exec, plan, explore, and orchestrator agents with distinct tool policies
- **Sidekick spawning**: Minions spawn child minions for parallel work — each with its own worktree
- **Agent definitions**: Markdown files with frontmatter configure agent behavior, base type, and prompts
- **Plan/Exec modes**: Strategic planning phase (analysis only) and execution phase (tool use)

### Organization

- **Stages**: Pipeline stages (Intake, Build, Review, Deploy, etc.) for organizing minions visually
- **Scheduling**: Cron-based jobs — morning briefings, nightly builds, weekly reports
- **Cost tracking**: Token usage and API spend per minion, per project, per team

### Tools

- **MCP tools**: 170+ functions for minion management, project CRUD, browser automation, and more
- **Document ingestion**: Analyze PDF, DOCX, XLSX, PPTX files directly in conversations
- **Rich output**: Mermaid diagrams, LaTeX, syntax-highlighted code, streaming markdown

### Runtime Modes

| Mode | Description |
| --- | --- |
| **Local** | Direct execution in your project directory |
| **Git Worktree** | Isolated branch-based development — each minion on its own branch |
| **SSH** | Remote execution on any server |
| **Docker** | Container-based sandboxed execution |

### Platforms

| Platform | Architecture | Installer |
| -------- | ------------ | --------- |
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x64) | `.dmg` |
| Windows | arm64 | `.exe` |
| Windows | x64 | `.exe` |
| Linux | arm64 | `.AppImage` |
| Linux | x86_64 | `.AppImage` |

Desktop (Electron), Web (server mode), CLI, and VS Code Extension.

---

## Download

**[Latest Release](https://github.com/latticeHQ/latticeWorkbench/releases/latest)**

Or install via Homebrew (macOS / Linux):

```bash
brew install latticehq/lattice/lattice-workbench
```

---

## Getting Started

### Standalone Mode

Workbench works standalone — no Runtime required for local development:

1. Install Lattice Workbench (download or `brew install`)
2. Open Lattice and create a project pointing at your repo
3. Create minions — each gets its own git worktree
4. Organize them into stages for pipeline-style organization
5. Set up scheduled jobs for recurring tasks (optional)

### With Lattice Runtime

For institutional coordination — identity, audit, cross-team governance:

1. [Deploy Lattice Runtime](https://github.com/latticeHQ/latticeRuntime#get-started)
2. Connect Workbench to your Runtime instance
3. Your agents now inherit organizational identity, authorization, and audit

When connected to Runtime, every agent action passes through the four enforcement gates — Identity, Authorization, Constraints, Audit — without Workbench implementing any of it. The stack inherits governance from the coordination layer.

---

## Agent Definitions

Lattice ships with a 10-stage software delivery pipeline in `.lattice/agents/`:

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

Agent definitions are markdown files with frontmatter. Build your own agents or customize the built-in ones:

```markdown
---
name: code-reviewer
base: review
model: claude-sonnet-4-6
tools: [read, grep, glob]
---

You are a senior code reviewer. Focus on security, performance,
and maintainability. Flag any OWASP Top 10 vulnerabilities.
```

---

## How Workbench Relates to Other Stacks

Workbench is the **Engineering Stack**. It is not the only stack.

The same architecture that powers Workbench can power stacks for any department:

| Stack | Domain | Who Builds It |
|---|---|---|
| **Engineering** (Workbench) | CI/CD, code review, testing, deployment | [@latticeHQ](https://github.com/latticeHQ) |
| **Clinical** | Patient coordination, care plans, compliance | Community |
| **Legal** | Contract review, compliance monitoring, drafting | Community |
| **Finance** | Expense tracking, forecasting, audit, reporting | Community |
| **Support** | Ticket triage, resolution, escalation, knowledge | Community |

Every stack inherits the same coordination primitives from Runtime — identity, authorization, budget, audit, networking. Stack developers focus entirely on domain logic.

**Building a stack?** See the [Stack SDK guide](https://github.com/latticeHQ/latticeRuntime/blob/develop/docs/stacks/README.md) and study this repo as the reference implementation.

---

## Ecosystem

| Component | Role | Repository |
|-----------|------|------------|
| [**Enterprise**](https://github.com/latticeHQ/latticeEnterprise) | Enterprise administration and governance | Coming soon |
| [**Homebrew**](https://github.com/latticeHQ/latticeHomebrew) | One-line install on macOS and Linux | [latticeHomebrew](https://github.com/latticeHQ/latticeHomebrew) |
| [**Inference**](https://github.com/latticeHQ/latticeInference) | Local AI serving — MLX on Apple Silicon, zero-config clustering | [latticeInference](https://github.com/latticeHQ/latticeInference) |
| [**Operator**](https://github.com/latticeHQ/latticeOperator) | Self-hosted deployment management for Lattice infrastructure | [latticeOperator](https://github.com/latticeHQ/latticeOperator) |
| [**Public**](https://github.com/latticeHQ/lattice) | Website + binary releases | [lattice](https://github.com/latticeHQ/lattice) |
| [**Registry**](https://github.com/latticeHQ/latticeRegistry) | Community ecosystem — Terraform modules, templates, stacks | [latticeRegistry](https://github.com/latticeHQ/latticeRegistry) |
| [**Runtime**](https://github.com/latticeHQ/latticeRuntime) | Coordination layer — identity, authorization, audit, budget | [latticeRuntime](https://github.com/latticeHQ/latticeRuntime) |
| [**SDK**](https://github.com/latticeHQ/latticeSDK) | Go SDK for building Department Stacks | [latticeSDK](https://github.com/latticeHQ/latticeSDK) |
| [**Terraform Provider**](https://github.com/latticeHQ/terraform-provider-lattice) | Infrastructure as code for Lattice deployments | [terraform-provider-lattice](https://github.com/latticeHQ/terraform-provider-lattice) |
| [**Toolbox**](https://github.com/latticeHQ/latticeToolbox) | macOS app manager for Lattice products | [latticeToolbox](https://github.com/latticeHQ/latticeToolbox) |
| **Workbench** (this repo) | Reference Engineering Stack — multi-model agent workspace | You are here |

---

## Development

See [AGENTS.md](./AGENTS.md) for development setup and guidelines.

## License

Lattice Workbench is licensed under [MIT](./LICENSE).

---

<div align="center">

**[latticeruntime.com](https://latticeruntime.com)** — The open-source coordination layer for institutional AI.

</div>
