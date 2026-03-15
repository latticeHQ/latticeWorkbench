<div align="center">

# The Lattice Preamble

### The founding document of the Lattice ecosystem

*Lattice Runtime is the open-source coordination layer for institutional AI.
Lattice Workbench is the reference Engineering Stack — the first stack built on Runtime.*

</div>

---

## Why This Exists

The models are here. The tool-use protocols are here. What's missing is the layer that coordinates AI across an entire organization — not just better individual tools, but governance that ensures every department's AI agents authenticate, communicate, and operate under the same rules.

Lattice is that layer.

---

## What We Believe

### 1. Institutions, not individuals.

The AI industry optimized for individual productivity. But institutions don't fail because one person lacks a copilot — they fail because departments can't coordinate, AI decisions can't be audited, and there's no governance over who authorized what.

AI should be organized as coordinated teams across departments — not as isolated assistants on individual desks.

### 2. Teams, not chatbots.

A chatbot is a toy. A copilot is a tool. Neither is a team.

AI should be organized as specialists who work in parallel — not as one omniscient assistant. An agent that writes code. An agent that reviews it. An agent that tests it. Each with its own workspace, its own tools, its own conversation history.

### 3. Your work should run on your desk.

Not scattered across SaaS dashboards. Not dependent on services that raise prices, change terms, or disappear. On hardware you own, with data you control.

### 4. Local first. Cloud optional.

Your agents run on your hardware. Your data stays on your machine. Cloud is an option for those who want it — never a requirement. Privacy is the default, not a premium feature.

### 5. Open by nature.

The platform is open source. Agent definitions are markdown files you can read and edit. Every tool runs on code you can audit. Enforcement logic must be auditable to be trusted.

No black boxes. No vendor lock-in. No surprises.

---

## The Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    LATTICE RUNTIME (Go)                       │
│              The Coordination Layer                           │
│                                                              │
│  Identity ─── Authorization ─── Audit ─── Budget             │
│  Cross-department routing · Agent lifecycle · Mesh networking │
│                                                              │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│          │          │          │          │                   │
│  ┌───────▼──┐ ┌─────▼────┐ ┌──▼─────┐ ┌─▼────────┐         │
│  │   Eng    │ │ Clinical │ │ Legal  │ │ Finance  │  ...     │
│  │  Stack   │ │  Stack   │ │ Stack  │ │  Stack   │         │
│  │(Workbnch)│ │          │ │        │ │          │         │
│  └──────────┘ └──────────┘ └────────┘ └──────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │          LATTICE INFERENCE (MLX) — Optional            │  │
│  │  Local AI on Apple Silicon · Zero-config clustering    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Runtime** is the coordination layer — it doesn't do the work, it governs the work.

**Stacks** are domain-specific AI workspaces. Each department plugs in the stack that fits their workflow. Runtime ensures every stack plays by the same rules.

**Workbench** is the reference Engineering Stack — the first stack built on Runtime, purpose-built for software teams.

---

## What Lattice Workbench Is

The reference Engineering Stack for [Lattice Runtime](https://github.com/latticeHQ/latticeRuntime). Purpose-built for software engineering teams.

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

---

## The Vocabulary

| Term | What It Means |
| --- | --- |
| **Minion** | An AI agent. It has a git worktree, a conversation history, tool access, and work to do. |
| **Stack** | A domain-specific AI workspace that connects to Runtime for coordination. Workbench is the Engineering Stack. |
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
| [**Enterprise**](https://github.com/latticeHQ/latticeEnterprise) | Enterprise administration and governance | Coming soon |
| [**Homebrew**](https://github.com/latticeHQ/latticeHomebrew) | One-line install on macOS and Linux | MIT |
| [**Inference**](https://github.com/latticeHQ/latticeInference) | Local AI serving — MLX on Apple Silicon, zero-config clustering | Apache 2.0 |
| [**Operator**](https://github.com/latticeHQ/latticeOperator) | Self-hosted deployment management for Lattice infrastructure | Apache 2.0 |
| [**Public**](https://github.com/latticeHQ/lattice) | Website + binary releases | — |
| [**Registry**](https://github.com/latticeHQ/latticeRegistry) | Community ecosystem — Terraform modules, templates, stacks | Apache 2.0 |
| [**Runtime**](https://github.com/latticeHQ/latticeRuntime) | Coordination layer — identity, authorization, audit, budget | Apache 2.0 |
| [**SDK**](https://github.com/latticeHQ/latticeSDK) | Go SDK for building Department Stacks | Apache 2.0 |
| [**Terraform Provider**](https://github.com/latticeHQ/terraform-provider-lattice) | Infrastructure as code for Lattice deployments | MPL 2.0 |
| [**Toolbox**](https://github.com/latticeHQ/latticeToolbox) | macOS app manager for Lattice products | MIT |
| [**Workbench**](https://github.com/latticeHQ/latticeWorkbench) | Reference Engineering Stack — multi-model agent workspace | MIT |

---

## The Open Source Commitment

Lattice is open source because enforcement must be auditable to be trusted. If the software decides "allow" or "deny", the decision logic must be inspectable.

Every agent definition is a markdown file you can read and edit. Every tool runs on code you can audit.

---

## How to Get Involved

- **Use it.** Install the Workbench, create some minions, build something.
- **Break it.** File issues, report security findings, push the edges.
- **Build a stack.** See the [Stack SDK guide](https://github.com/latticeHQ/latticeRuntime/blob/develop/docs/stacks/README.md) for building domain-specific stacks on Runtime.
- **Shape it.** Join [GitHub Discussions](https://github.com/latticeHQ/latticeRuntime/discussions) on architecture decisions that affect everyone.

---

<div align="center">

**[latticeruntime.com](https://latticeruntime.com)**

</div>
