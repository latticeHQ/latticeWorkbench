<div align="center">

# The Lattice Preamble

### The founding document of the Lattice ecosystem

*Lattice is the open-source AI agent workbench —
run a team of AI specialists on your own hardware.*

</div>

---

## Why This Exists

The models are here. The tool-use protocols are here. What's missing is the layer that organizes AI into something that works like a team — specialists with clear responsibilities, workflows that move work from idea to delivery, and isolation that lets agents work in parallel without stepping on each other.

Lattice is that layer.

---

## What We Believe

### 1. Teams, not chatbots.

The AI industry got the abstraction wrong.

A chatbot is a toy. A copilot is a tool. Neither is a team.

AI should be organized as specialists who work in parallel — not as one omniscient assistant. An agent that writes code. An agent that reviews it. An agent that tests it. Each with its own workspace, its own tools, its own conversation history.

### 2. Your work should run on your desk.

Not scattered across SaaS dashboards. Not dependent on services that raise prices, change terms, or disappear. On hardware you own, with data you control.

### 3. Local first. Cloud optional.

Your agents run on your hardware. Your data stays on your machine. Cloud is an option for those who want it — never a requirement. Privacy is the default, not a premium feature.

### 4. Open by nature.

The platform is open source. Agent definitions are markdown files you can read and edit. Every tool runs on code you can audit.

No black boxes. No vendor lock-in. No surprises.

---

## What Lattice Is

**Lattice Workbench** is a multi-model AI agent workbench for software engineering.

You create minions (AI agents). Each gets its own git worktree, conversation history, and tool access. They work in parallel — planning, coding, testing, reviewing — organized into pipeline stages.

### Core Capabilities

- **Minions**: AI agents with isolated git worktrees, full tool access, and persistent conversation history
- **Multi-model AI**: Claude, GPT, Gemini, Grok, DeepSeek, Ollama, OpenRouter, Bedrock — swap freely
- **Agent types**: Built-in exec, plan, explore, and orchestrator agents with distinct tool policies
- **Sidekick spawning**: Minions spawn child minions for parallel work via `parentMinionId`
- **Stages**: Pipeline stages (Intake, Build, Review, Deploy, etc.) for organizing minions visually
- **Scheduling**: Cron-based jobs — morning briefings, nightly builds, weekly reports
- **MCP tools**: 170+ functions for minion management, project CRUD, browser automation, and more
- **Cost tracking**: Token usage and API spend per minion
- **Runtime modes**: Local, git worktree, SSH, Docker
- **Platforms**: Desktop (macOS, Windows, Linux), web server mode, CLI, VS Code extension
- **Agent definitions**: Markdown files with frontmatter that configure agent behavior, base type, and prompts

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Your Hardware                       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │          LATTICE WORKBENCH                     │  │
│  │                                                │  │
│  │  Minions · Stages · Schedules · MCP Tools      │  │
│  │  Multi-model AI · Git worktree isolation       │  │
│  │  Cost tracking · Agent definitions             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │          LATTICE INFERENCE (optional)          │  │
│  │  Local AI models on Apple Silicon via MLX      │  │
│  │  Zero API costs · Zero data leakage            │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## The Vocabulary

| Term | What It Means |
| --- | --- |
| **Minion** | An AI agent. It has a git worktree, a conversation history, tool access, and work to do. |
| **Stage** | A pipeline stage — Intake, Build, Review, Deploy. Organizes minions visually. |
| **Sidekick** | A minion spawned by another minion to handle a subtask. |
| **Agent definition** | A markdown file (`.lattice/agents/*.md`) that configures an agent's base type, prompt, and behavior. |

---

## The Engineering Agent Definitions

Lattice ships with agent definitions for a 10-stage software delivery pipeline:

| Stage | Agent | What They Do |
| --- | --- | --- |
| **Intake** | `intake.md` | Triage incoming issues, feature requests, bug reports |
| **Discovery** | `discovery.md` | Research, spikes, understand the problem space |
| **Planning** | `planning.md` | Architecture decisions, task breakdown |
| **Build** | `build.md` | Feature implementation, bug fixes |
| **Test** | `test.md` | Test plans, regression testing, coverage |
| **Review** | `review.md` | Code review, quality gates, security checks |
| **Docs** | `docs.md` | Documentation, changelogs, API docs |
| **Deploy** | `deploy.md` | CI/CD, releases, deployment pipelines |
| **Monitor** | `monitor.md` | Production monitoring, alerts, health checks |
| **Learning** | `learning.md` | Retrospectives, post-mortems, knowledge capture |

Plus `chief-of-staff.md` (orchestrator base) and generic `exec.md` / `plan.md` agents.

---

## Ecosystem

| Component | What It Does | License |
| --- | --- | --- |
| [**Lattice Workbench**](https://github.com/latticeHQ/latticeWorkbench) | AI agent workbench. Minions, stages, scheduling, multi-model chat. | MIT |
| [**Lattice Inference**](https://github.com/latticeHQ/lattice-inference) | Local AI serving. MLX on Apple Silicon, zero-config clustering. | Apache 2.0 |
| [**Lattice Runtime**](https://github.com/latticeHQ/lattice) | Identity, authorization, audit, deployment constraints. | Apache 2.0 |
| [**Homebrew Tap**](https://github.com/latticeHQ/homebrew-lattice) | One-line install on macOS and Linux. | MIT |

---

## The Open Source Commitment

Lattice is open source because your tools should be inspectable, modifiable, and owned by you.

Every agent definition is a markdown file you can read and edit. Every tool runs on code you can audit.

---

## How to Get Involved

- **Use it.** Install the Workbench, create some minions, build something.
- **Break it.** File issues, report security findings, push the edges.
- **Build on it.** Write agent definitions, create integrations.
- **Shape it.** Join the discussion on architecture decisions that affect everyone.

---

<div align="center">

**[latticeruntime.com](https://latticeruntime.com)**

</div>
