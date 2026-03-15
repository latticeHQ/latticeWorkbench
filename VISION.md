# Vision

## Lattice — The Coordination Layer for Institutional AI

AI has made software the cheapest it has ever been to create. Individual developers are 10x more productive. But this productivity hasn't translated into institutional value.

Why? Because institutions don't need more copilots. They need **coordination**.

## The Problem

a16z calls it "Institutional Intelligence" — the missing layer between individual AI tools and organizational outcomes. We call it the coordination layer, and nobody has built it yet.

Today, an enterprise deploying AI agents duct-tapes together 7+ separate tools:

- **Auth0 / Clerk** for identity
- **Brex / Ramp** for budget and spend control
- **Datadog / LangSmith** for observability
- **Drata / Vanta** for compliance
- **Notion / Confluence** for documentation
- **PagerDuty** for alerting
- **Custom code** for coordination between all of it

None of them talk to each other. No unified audit trail. No cross-cutting governance. Every integration is a liability. Every agent is an island.

This is the 1890s textile mill problem. Factories installed electric motors but kept the layout designed for steam engines. Output barely improved for 30 years — until they redesigned the entire facility around electricity.

**Enterprises today are swapping the motor. They haven't redesigned the factory.**

## The Thesis

Software is at its cheapest to create. The unbundling era of SaaS — a separate tool for every function — is ending. What institutions need now is **rebundling**: a single coordination layer that provides everything their AI agents need to operate as an institution, not as a collection of individuals.

The seven requirements of institutional AI (per a16z's framework):

1. **Coordination** — Agents must work together, not row in opposing directions
2. **Signal over Noise** — Deterministic, auditable processes instead of unpredictable agents
3. **Objectivity** — Systems that enforce standards and challenge reasoning
4. **Edge** — Purpose-built capabilities for specific domains
5. **Outcomes** — Revenue and institutional impact, not just time savings
6. **Enablement** — Process engineering that drives adoption across the organization
7. **Unprompted Action** — Systems that act proactively, detecting risks and opportunities

No combination of point solutions delivers all seven. You need a coordination layer.

## The Solution

Lattice Runtime is the open-source coordination layer for institutional AI. One binary that provides:

- **Identity & Auth** — OAuth, OIDC, SAML, mTLS, API keys, cloud IAM. Every agent gets a cryptographic principal.
- **Authorization** — RBAC + ABAC with policy-as-code (Rego). Fine-grained, dynamic, cross-platform.
- **Budget & Spend** — Per-agent and per-department spend limits, cost tracking, alerts.
- **Audit & Compliance** — Immutable, tamper-evident, cryptographically chained records. SOC2, HIPAA, FedRAMP, GDPR.
- **Coordination** — Cross-department messaging, event routing, escalation, shared state.
- **Networking** — Zero-trust mesh (Tailscale + WireGuard), P2P with relay fallback.
- **Observability** — Metrics, logs, health checks, tracing (Prometheus + OpenTelemetry).
- **Agent Lifecycle** — Provision, deploy, scale, schedule, TTL, auto-update.

One layer. One database. Open source.

**Replace 7 SaaS tools with `docker compose up`.**

## Department Stacks

The coordination layer is horizontal — build once, use everywhere. **Department Stacks** are vertical — domain-specific applications that plug into the coordination layer.

```
Coordination Layer (Lattice Runtime)
    │
    ├── Engineering Stack    → CI/CD, code review, testing, deployment
    ├── HR Stack             → Recruiting, onboarding, compliance
    ├── Legal Stack          → Contract review, compliance monitoring
    ├── Finance Stack        → Expense tracking, forecasting, audit
    ├── Support Stack        → Ticket triage, resolution, escalation
    └── [Your Stack]         → Whatever your institution needs
```

Each stack inherits identity, budget, audit, networking, and coordination for free. Stack developers focus purely on domain logic. This is how you scale to every vertical without building everything yourself.

The coordination layer is the moat. Once an institution has 2+ department stacks on Lattice, the switching cost is the unified governance, audit trail, and identity system that holds it all together.

## Why Open Source?

**Enforcement must be open to be trusted.**

If the software decides "allow" or "deny," the decision logic must be auditable. Institutions cannot trust a black box with governance over their AI agents. The coordination layer — the part that makes enforcement decisions — must be open source.

This is not a business decision first. It is a systems decision.

### What Is Open (Apache 2.0)

Everything that evaluates identity, authorization, policy, and audit. Everything that decides "allow vs. deny." Everything that mediates execution. The coordination layer is open because correctness and transparency are mandatory for regulated environments.

A solo developer deserves the same governance infrastructure as a Fortune 500.

### What Is Enterprise-Licensed (Lattice Enterprise)

Enterprise governance, administration, and operational features:

- SSO/SAML and directory integrations (Active Directory, Okta, Entra ID)
- Policy lifecycle management (versioning, approvals, rollbacks)
- Compliance reporting and exports (SOC2, HIPAA, FedRAMP, GDPR)
- Administrative control planes
- Long-term support guarantees

These features do not decide what is allowed. They standardize operation and governance across large deployments.

### The Principle

**Enforcement must be open to be trusted.**
**Governance must be controlled to remain reliable.**

## The Kubernetes Parallel

Before Kubernetes, every team ran containers differently. Docker made packaging easy, but production orchestration was fragmented. Kubernetes became the open-source standard — not by competing with clouds, but by running on them.

AI agents are having their Kubernetes moment. Everyone is building them. Nobody has the coordination layer to run them institutionally. Lattice is the open-source, vendor-neutral runtime that works everywhere — cloud, self-hosted, air-gapped.

The clouds will embrace it because it expands their addressable market. Enterprises will adopt it because it's the only layer that provides unified governance across all their AI agents, regardless of vendor.

## The Impact

The institutional AI market is wide open. Individual AI tools have saturated. But the coordination layer — the infrastructure that turns individual AI into institutional intelligence — barely exists.

Lattice is that layer. Open source. Self-hosted. Vendor-neutral.

**Your agents. Your coordination. Your rules. Your infrastructure.**

## The Ecosystem

Lattice is not a single tool — it's an integrated platform:

| Component | Role | License |
|-----------|------|---------|
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

Together, these components form the coordination layer for institutional AI — governing how agents authenticate, communicate, and operate across an organization.

---

*Inspired by [a16z's "Institutional AI vs Individual AI"](https://www.a16z.news/p/institutional-ai-vs-individual-ai) — the thesis that the real value in AI accrues at the institutional layer, not the individual layer.*
