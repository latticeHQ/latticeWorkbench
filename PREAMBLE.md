<div align="center">

# The Lattice Preamble

### The founding document of the Lattice ecosystem

*Lattice is the open-source platform for building your personal team of AI agents —
where every minion gets an identity, permissions, compute, and a mission.*

</div>

---

## Why This Exists

Software ate the world. AI is eating software. But right now, working with AI agents looks like this: one chat window, one conversation, one task at a time. Copy-paste results between tools. Babysit every step. Hope nothing goes sideways.

That is not how work gets done.

When a company needs to ship something real, they don't hand one person a chat window. They assemble a team. Specialists with clear roles, defined authority, and the right tools. A senior architect delegates to junior engineers. A project lead coordinates across workstreams. Everyone operates within guardrails — not because guardrails are fun, but because guardrails are what let you trust people to run autonomously.

Lattice exists because AI agents deserve the same structure.

We are building the infrastructure for **personal AI teams** — your own roster of minions that plan, investigate, build, test, and deploy on your behalf. Not one agent doing everything. A coordinated crew, each with the right skills, the right access, and the right constraints.

Starting with software engineering. Expanding to every knowledge profession that exists.

## The Vision

Everyone gets their own consulting agency.

A developer summons a crew of minions — one scouts the codebase, one architects the solution, one builds it, one writes the tests. They coordinate. They report back. You review the work and ship it.

A lawyer gets a crew that researches case law, drafts briefs, and flags conflicts of interest — all governed by the same ethical walls that bind human associates. A marketing team summons minions that analyze campaign data, draft copy, and A/B test headlines across channels. A startup founder benches a minion after a funding round and summons a new one for product launch.

This is not science fiction. The models are here. The tool-use protocols are here. What is missing is the **operating system** — the layer that gives agents real identity, real permissions, real audit trails, and real deployment infrastructure.

Lattice is that layer.

## Core Principles

### 1. Open Enforcement

The enforcement kernel — identity, authorization, audit, deployment constraints — is open source and inspectable. You don't get security by obscurity. You get security by publishing your enforcement logic and letting the community verify it.

Every minion that runs through Lattice gets a cryptographic identity. Every tool call is authorized against a policy you define. Every action is logged to an audit trail you own. This is not optional. This is the foundation.

### 2. Vendor Neutral

Lattice doesn't care which model runs your minions. Claude, GPT, Gemini, Grok, Deepseek, Llama, Mistral, or your own fine-tune running on local hardware — swap freely. The Workbench treats every provider the same. Your minions are loyal to you, not to a model vendor.

### 3. Self-Hosted First

Your agents. Your data. Your infrastructure. Lattice runs on your laptop, your server, your cloud account, or your air-gapped lab. The platform doesn't phone home. There is no SaaS dependency in the critical path. You can run your entire minion roster on a Mac Mini in your closet if that's what the mission requires.

### 4. Composable Teams

A single minion is useful. A coordinated crew is transformative. Lattice is built around the idea that agents work best in structured teams — a senior minion summoning sidekicks for subtasks, a crew organized by practice area, an orchestrator managing the full mission pipeline.

This is not just a UI metaphor. The runtime enforces delegation chains, the Workbench visualizes team topology in real time, and the audit trail traces every decision back through the chain of command.

## The Vocabulary

Lattice uses language that reflects how teams actually work:

- **Minion** — An AI agent on your roster. It has an identity, a runtime environment, a conversation history, and a mission. Summon one when you need work done.
- **Crew** — A practice group. Organize your minions by domain — backend crew, security crew, research crew — the same way a consulting firm organizes its partners into practice areas.
- **Sidekick** — A minion brought in by another minion to handle a subtask. Sidekicks inherit scoped permissions from their parent and report back when the work is done.
- **Summon** — Deploy a new minion. Pick a model, choose an agent type, configure tools and permissions, and launch.
- **Bench** — Archive a minion between missions. Its history and configuration are preserved. Pull it off the bench when you need it again.
- **Mission** — What a minion is working on. A mission has a goal, a context, and a measurable outcome.
- **Workbench** — Your agency headquarters. The place where you summon minions, organize crews, monitor missions, and review results.

## The Ecosystem

Lattice is not one repository. It is a coordinated system of components, each with a clear responsibility:

| Component | What It Does | License |
| --- | --- | --- |
| [**Lattice Runtime**](https://github.com/latticeHQ/lattice) | The enforcement kernel. Identity, authorization, audit, and deployment constraints. Every minion passes through Runtime's four gates before it acts. | Apache 2.0 |
| [**Lattice Workbench**](https://github.com/latticeHQ/latticeWorkbench) | Your agency headquarters. Summon minions, organize crews, monitor missions, manage tools. Desktop, web, and CLI. | MIT |
| [**Lattice Inference**](https://github.com/latticeHQ/lattice-inference) | Local LLM serving. MLX on Apple Silicon, CUDA on NVIDIA, zero-config multi-node clustering. Your minions, your hardware, zero API costs. | Apache 2.0 |
| [**Lattice Registry**](https://github.com/latticeHQ/lattice-registry) | Community ecosystem. Templates, modules, and infrastructure presets for Docker, Kubernetes, AWS, GCP, and Azure. One command to deploy a governed minion anywhere. | Apache 2.0 |
| [**Terraform Provider**](https://github.com/latticeHQ/terraform-provider-lattice) | Infrastructure as code for Lattice deployments. Declare your minion fleet in HCL. | MPL 2.0 |
| [**Homebrew Tap**](https://github.com/latticeHQ/homebrew-lattice) | One-line install on macOS and Linux. | MIT |

### How They Fit Together

**Runtime** is the foundation. It doesn't care where agents come from — Workbench, a CLI script, a CI pipeline, or a third-party tool. If an agent wants identity, authorization, or audit, it goes through Runtime.

**Workbench** is the primary interface for humans. It's where you think about your minions as a team rather than as individual processes. It connects to Runtime via oRPC for enforcement, to Inference for local models, and to Registry for deployment templates.

**Inference** is optional but powerful. Plug it in and your minions can run on local hardware with zero data leakage and zero API costs. Unplug it and they fall back to cloud providers seamlessly.

**Registry** is how the community shares. Built a good Docker template for a code review minion? Publish it. Found a solid Kubernetes preset for a multi-minion crew? Share it. The Registry is the package manager for agent infrastructure.

## Who This Is For

**Today:** Software engineers who want AI agents that actually work in teams — planning, coding, testing, reviewing, and deploying as a coordinated crew rather than a single chat window.

**Tomorrow:** Every knowledge worker who has ever thought "I need a team for this but I don't have the budget for one." Lawyers, analysts, marketers, researchers, operations teams. The infrastructure is the same. The agent definitions change.

## How to Get Involved

Lattice is open source because we believe the infrastructure layer for AI agents should be a public good. The enforcement logic that governs what agents can do is too important to be a black box.

- **Use it.** Install the Workbench, summon your first minion, build something.
- **Break it.** File issues, report security findings, push the edges.
- **Build on it.** Write agent templates, publish Registry modules, create integrations.
- **Shape it.** Join the discussion on architecture decisions that affect everyone.

The repositories are open. The enforcement is transparent. The mission is clear.

Build your team.

---

<div align="center">

**[latticeruntime.com](https://latticeruntime.com)**

Your minions. Your models. Your rules. Your infrastructure.

</div>
