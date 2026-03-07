<div align="center">

# The Lattice Preamble

### The founding document of the Lattice ecosystem

*Lattice is the open-source platform for deploying companies powered by AI workforces —
where every department runs autonomously on your own hardware.*

</div>

---

## Why This Exists

A company used to require an office, a team, and a year of hiring.

Then it required a laptop and a dozen SaaS subscriptions.

Now it requires one command.

The models are here. The tool-use protocols are here. What's missing is the layer that organizes AI into something that actually works like a company — departments with clear responsibilities, roles with specific expertise, workflows that move work from idea to delivery, and governance that lets you trust the system enough to walk away.

Lattice is that layer.

---

## What We Believe

### 1. Companies are software now.

Music became files. Books became ebooks. Stores became Shopify instances.

Companies are next.

A company is a set of processes, roles, and decisions organized toward a goal. Every part of that sentence can be expressed in code and executed by intelligence. The company itself becomes something you deploy.

### 2. Anyone should be able to build a company.

Not just people with funding, connections, or the ability to hire a team. A student in Lagos. A designer in Osaka. A retiree in Kansas. If you have a vision and a Mac, you can deploy a company that operates with the capacity of a well-funded startup.

Lattice democratizes the ability to build. That's the mission.

### 3. Your company should run on your desk.

Your photos live on your phone. Your music lives on your laptop. Your company should too.

Not scattered across 50 SaaS dashboards you barely understand. Not dependent on services that raise prices, change terms, or disappear. On hardware you own, with data you control.

A Mac Studio on your desk — or a cluster of Macs connected via Thunderbolt for serious scale. Your entire company inside it. Always on. Always working.

### 4. Departments, not chatbots.

The AI industry got the abstraction wrong.

A chatbot is a toy. A copilot is a tool. Neither is a company.

A company has structure: departments with clear responsibilities, roles with specific expertise, workflows that move work from idea to delivery. AI should be organized the same way — not as one omniscient assistant, but as a team of specialists who coordinate.

An engineering department that ships code. A marketing department that creates content. A sales department that closes deals. Each with its own space, its own tools, its own budget. Just like a real company. Because it *is* a real company.

### 5. Deploy, don't assemble.

Building a company used to take months of assembling pieces — hiring, onboarding, setting up tools, defining processes. Each piece had to be found, negotiated, and integrated by hand.

Deploying is instant. You choose a company template, describe your vision, and every department comes online in seconds — configured, coordinated, and ready to operate.

The companies of the future won't be assembled. They'll be deployed.

---

## The Product

**Lattice** is an open-source platform that deploys and operates entire companies powered by AI workforces.

You describe the company you want to build. Lattice deploys it.

Every department comes online — engineering, marketing, sales, support, finance — each running as an isolated, autonomous unit. Each department has its own workspace, its own minions, its own tools, its own schedule, its own budget.

The founder is the CEO. Lattice is the company.

---

## Design Principles

### Invisible until needed.
The best interface is the one that disappears. The company runs. You check in when you want, not when the system demands it. No notification storms. No dashboards to monitor. Results appear. Problems escalate. Everything else happens quietly.

### Opinionated by default, flexible by design.
A department template deploys with sensible defaults — stage leads, schedules, tools, and pipeline stages. It works out of the box. But every role, every schedule, every tool can be customized. Start with our opinion. Make it yours over time.

### Structure creates freedom.
Constraints are not limitations. A department with a clear budget won't overspend. A minion with a clear role won't overstep. An audit trail with every action won't miss a mistake. Structure is what lets you trust the system enough to walk away.

### Local first. Cloud optional.
Your company runs on your hardware. Your data stays on your machine. Cloud is an option for those who want it — never a requirement. Privacy is the default, not a premium feature.

### Open by nature.
The platform is open source. Company templates are community-created. Anyone can build a "restaurant-in-a-box" or a "law-firm-in-a-box" and share it. The best companies will be the ones the community refines together.

---

## The Architecture

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

**Runtime** — The backbone. Deploys departments, enforces policies, coordinates cross-department communication, tracks costs. Written in Go. Production-grade. Every minion passes through Runtime's four enforcement gates before it acts: Identity, Authorization, Constraints, Audit.

**Workbench** — The workspace. Each department gets its own instance with its own minions, tools, schedules, and chat history. Fully isolated. Written in TypeScript/React.

**Inference** — The brain. Runs AI models locally on Apple Silicon via MLX. Zero-config multi-node clustering via mDNS. No data leaves your machine. Routine tasks cost nothing.

---

## The Ecosystem

| Component | What It Does | License |
| --- | --- | --- |
| [**Lattice Runtime**](https://github.com/latticeHQ/lattice) | The enforcement backbone. Identity, authorization, audit, and deployment constraints. Cross-department coordination and budget management. | Apache 2.0 |
| [**Lattice Workbench**](https://github.com/latticeHQ/latticeWorkbench) | Department workspace. Deploy minions, organize stages, run pipeline stages, manage tools. Desktop, web, and CLI. | MIT |
| [**Lattice Inference**](https://github.com/latticeHQ/lattice-inference) | Local AI serving. MLX on Apple Silicon, CUDA on NVIDIA, zero-config multi-node clustering. Your minions, your hardware, zero API costs. | Apache 2.0 |
| [**Lattice Registry**](https://github.com/latticeHQ/lattice-registry) | Community ecosystem. Company templates, department templates, and infrastructure presets for Docker, Kubernetes, AWS, GCP, and Azure. | Apache 2.0 |
| [**Terraform Provider**](https://github.com/latticeHQ/terraform-provider-lattice) | Infrastructure as code for Lattice deployments. | MPL 2.0 |
| [**Homebrew Tap**](https://github.com/latticeHQ/homebrew-lattice) | One-line install on macOS and Linux. | MIT |

---

## The Vocabulary

| Term | What It Means |
| --- | --- |
| **Minion** | An AI worker. It has an identity, a runtime environment, a conversation history, and work to do. Not "employee" — that's a human term. |
| **Department** | A business unit — Engineering, Marketing, Sales. Each runs as its own Workbench instance with its own minions, tools, and budget. |
| **Stage** | A pipeline stage within a department — Intake, Build, Review, Deploy. Organizes how work flows through the department. |
| **Stage Lead** | The minion that owns a stage. Coordinates work in that stage and can spawn more minions as needed. |
| **Chief of Staff** | The coordinator across all stages. Daily briefings, task routing, escalation. When you chat with Lattice, you're talking to your CoS. |
| **Sidekick** | A minion brought in by another minion to handle a subtask. Inherits scoped permissions from their parent. |
| **Founder** | The human. The CEO. The one who deploys and directs. |

---

## The First Company: Lattice Builds Lattice

The first company we deploy on Lattice is **Lattice itself**. The product builds the product. The ultimate proof that it works.

**Departments (added as needed):**

| Department | What It Does |
|---|---|
| **Engineering** | Architecture, implementation, code review, QA, CI/CD, releases |
| **Product** | Requirements, specs, user stories, roadmap, user research |
| **Marketing** | Content creation, social media, SEO, growth analytics, brand |
| **Sales** | Outbound prospecting, lead qualification, pipeline management |
| **Support** | Community support, issue triage, feedback collection, docs |
| **Finance** | Cost tracking, cash flow, invoicing, budget management |

We start with Engineering. It builds Lattice. We learn what works from real usage — not idealized dreams. Other departments get added when real needs arise.

**The operating cycle:**

```
Founder: "Build Lattice — the company deployment platform"
                    │
          ┌─────────▼──────────┐
          │  Chief of Staff    │  Morning briefing, routes work to departments
          └─────────┬──────────┘
                    │
     ┌──────────────┼──────────────┬──────────────┐
     │              │              │              │
┌────▼────┐  ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
│ Product │  │Engineering│ │Marketing  │ │  Sales    │
│ defines │  │  builds   │ │ spreads   │ │  closes   │
│ what    │  │  it       │ │ the word  │ │  deals    │
└────┬────┘  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
     │              │              │              │
     └──────────────┼──────────────┴──────────────┘
                    │
          ┌─────────▼──────────┐
          │    Support         │  Users give feedback
          └─────────┬──────────┘
          ┌─────────▼──────────┐
          │    Finance         │  Tracks the money
          └─────────┬──────────┘
          ┌─────────▼──────────┐
          │  Chief of Staff    │  Reports to Founder — cycle repeats
          └────────────────────┘
```

Every improvement to Lattice makes every Lattice-deployed company better.

---

## What Lattice Is Not

**Not a chatbot.** You don't talk to one AI. You run a company of specialists.

**Not a dev tool.** Engineering is one department. There are also marketing, sales, support, finance. The company is the product, not the code.

**Not a workflow builder.** You don't drag and drop boxes. You deploy a company and it figures out the workflow. The minions plan, adapt, and coordinate.

**Not cloud-dependent.** Your company runs on your hardware. We'll offer cloud as an option. Never as a requirement.

**Not a walled garden.** Open source. Open templates. Open ecosystem. Build your own company template. Share it with the world.

---

## The Roadmap

**Now**: Launch with the Engineering department template. It builds Lattice. Ship, learn, iterate.

**Next**: Add departments one at a time based on real needs. Each department earns its place.

**Then**: Full company template emerges from battle-tested departments. Community creates more — e-commerce, agency, media, consultancy.

**Later**: Template marketplace. Multi-machine Thunderbolt clusters. Cloud option.

**Eventually**: Every new company starts as a Lattice deployment.

---

## The Open Source Commitment

Lattice is open source because companies should be inspectable, modifiable, and owned by their founders.

Every agent definition is a markdown file you can read and edit. Every company template is a YAML file you can fork. Every department runs on code you can audit.

No black boxes. No vendor lock-in. No surprises.

---

## How to Get Involved

- **Use it.** Install the Workbench, deploy your first department, build something.
- **Break it.** File issues, report security findings, push the edges.
- **Build on it.** Write department templates, publish Registry modules, create integrations.
- **Shape it.** Join the discussion on architecture decisions that affect everyone.

The repositories are open. The enforcement is transparent. The mission is clear.

Deploy your company.

---

<div align="center">

**[latticeruntime.com](https://latticeruntime.com)**

From idea to company. One command.

</div>
