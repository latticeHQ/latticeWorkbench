---
name: lattice-docs
description: Index + offline snapshot of Lattice documentation (progressive disclosure).
---

# lattice docs

This built-in skill helps the agent answer questions about **Lattice** (Runtime Enforcement and Identity Infrastructure for Autonomous AI Agents) without dumping the entire docs into context.

## How to use

### Prefer: read the bundled docs snapshot (recommended)

This skill bundles an **offline snapshot of the Lattice docs** under `references/docs/`.

Why prefer the bundled snapshot?

1. The docs tree below is guaranteed to match what’s embedded.
2. It’s more likely to match *your installed Lattice version* (the live site may be ahead).

To read a specific page:

```ts
agent_skill_read_file({
  name: "lattice-docs",
  filePath: "references/docs/config/models.mdx",
});
```

### Fallback: bundled docs

If the bundled docs don't mention something, refer to the local documentation in the `docs/` directory.

#### Docs tree (auto-generated)

Use this index to find a page's:

- **Docs route** (for `web_fetch`)
- **Embedded file path** (for `agent_skill_read_file`)

<!-- BEGIN DOCS_TREE -->
- **Documentation**
  - **Getting Started**
    - Introduction (`/`) → `references/docs/index.mdx`
    - Install (`/install`) → `references/docs/install.mdx` — Download and install Lattice for macOS, Linux, and Windows
    - **Models**
      - Models (`/config/models`) → `references/docs/config/models.mdx` — Select and configure AI models in Lattice
      - Providers (`/config/providers`) → `references/docs/config/providers.mdx` — Configure API keys and settings for AI providers
    - Why Parallelize? (`/getting-started/why-parallelize`) → `references/docs/getting-started/why-parallelize.mdx` — Use cases for running multiple AI agents in parallel
    - Lattice Codes (`/getting-started/lattice-codes`) → `references/docs/getting-started/lattice-codes.mdx` — Redeem free LLM token credits for evaluating Lattice
    - CLI (`/reference/cli`) → `references/docs/reference/cli.mdx` — Run one-off agent tasks from the command line with `lattice run`
  - **Workspaces**
    - Workspaces (`/workspaces`) → `references/docs/workspaces/index.mdx` — Isolated development environments for parallel agent work
    - Forking Workspaces (`/workspaces/fork`) → `references/docs/workspaces/fork.mdx` — Clone workspaces with conversation history to explore alternatives
    - Message Sharing (`/workspaces/sharing`) → `references/docs/workspaces/sharing.mdx` — Share encrypted messages with cryptographic signatures via Lattice
    - **Compaction**
      - Compaction (`/workspaces/compaction`) → `references/docs/workspaces/compaction/index.mdx` — Managing conversation context size with compaction
      - Manual Compaction (`/workspaces/compaction/manual`) → `references/docs/workspaces/compaction/manual.mdx` — Commands for manually managing conversation context
      - Automatic Compaction (`/workspaces/compaction/automatic`) → `references/docs/workspaces/compaction/automatic.mdx` — Let Lattice automatically compact your conversations based on usage or idle time
      - Customization (`/workspaces/compaction/customization`) → `references/docs/workspaces/compaction/customization.mdx` — Customize the compaction system prompt
    - **Runtimes**
      - Runtimes (`/runtime`) → `references/docs/runtime/index.mdx` — Configure where and how Lattice executes agent workspaces
      - Local Runtime (`/runtime/local`) → `references/docs/runtime/local.mdx` — Run agents directly in your project directory
      - Worktree Runtime (`/runtime/worktree`) → `references/docs/runtime/worktree.mdx` — Isolated git worktree environments for parallel agent work
      - SSH Runtime (`/runtime/ssh`) → `references/docs/runtime/ssh.mdx` — Run agents on remote hosts over SSH for security and performance
      - Lattice Runtime (`/runtime/lattice`) → `references/docs/runtime/lattice.mdx` — Run agents on Lattice workspaces
      - Docker Runtime (`/runtime/docker`) → `references/docs/runtime/docker.mdx` — Run agents in isolated Docker containers
      - Dev Container Runtime (`/runtime/devcontainer`) → `references/docs/runtime/devcontainer.mdx` — Run agents in containers defined by devcontainer.json
    - **Hooks**
      - Init Hooks (`/hooks/init`) → `references/docs/hooks/init.mdx` — Run setup commands automatically when creating new workspaces
      - Tool Hooks (`/hooks/tools`) → `references/docs/hooks/tools.mdx` — Block dangerous commands, lint after edits, and set up your environment
      - Environment Variables (`/hooks/environment-variables`) → `references/docs/hooks/environment-variables.mdx` — Environment variables available in agent bash commands and hooks
  - **Agents**
    - Agents (`/agents`) → `references/docs/agents/index.mdx` — Define custom agents (modes + subagents) with Markdown files
    - Instruction Files (`/agents/instruction-files`) → `references/docs/agents/instruction-files.mdx` — Configure agent behavior with AGENTS.md files
    - Agent Skills (`/agents/agent-skills`) → `references/docs/agents/agent-skills.mdx` — Share reusable workflows and references with skills
    - Plan Mode (`/agents/plan-mode`) → `references/docs/agents/plan-mode.mdx` — Review and collaborate on plans before execution
    - System Prompt (`/agents/system-prompt`) → `references/docs/agents/system-prompt.mdx` — How Lattice constructs the system prompt for AI models
    - Prompting Tips (`/agents/prompting-tips`) → `references/docs/agents/prompting-tips.mdx` — Tips and tricks for getting the most out of your AI agents
  - **Configuration**
    - MCP Servers (`/config/mcp-servers`) → `references/docs/config/mcp-servers.mdx` — Extend agent capabilities with Model Context Protocol servers
    - Project Secrets (`/config/project-secrets`) → `references/docs/config/project-secrets.mdx` — Manage environment variables and API keys for your projects
    - Agentic Git Identity (`/config/agentic-git-identity`) → `references/docs/config/agentic-git-identity.mdx` — Configure a separate Git identity for AI-generated commits
    - Keyboard Shortcuts (`/config/keybinds`) → `references/docs/config/keybinds.mdx` — Complete keyboard shortcut reference for Lattice
    - Notifications (`/config/notifications`) → `references/docs/config/notifications.mdx` — Configure how agents notify you about important events
    - Vim Mode (`/config/vim-mode`) → `references/docs/config/vim-mode.mdx` — Vim-style editing in the Lattice chat input
  - **Guides**
    - GitHub Actions (`/guides/github-actions`) → `references/docs/guides/github-actions.mdx` — Automate your workflows with lattice run in GitHub Actions
    - Agentic Git Identity (`/config/agentic-git-identity`) → `references/docs/config/agentic-git-identity.mdx` — Configure a separate Git identity for AI-generated commits
    - Prompting Tips (`/agents/prompting-tips`) → `references/docs/agents/prompting-tips.mdx` — Tips and tricks for getting the most out of your AI agents
  - **Integrations**
    - VS Code Extension (`/integrations/vscode-extension`) → `references/docs/integrations/vscode-extension.mdx` — Pair Lattice workspaces with VS Code and Cursor editors
  - **Reference**
    - Telemetry (`/reference/telemetry`) → `references/docs/reference/telemetry.mdx` — What Lattice collects, what it doesn’t, and how to disable it
    - Storybook (`/reference/storybook`) → `references/docs/reference/storybook.mdx` — Develop and test Lattice UI states in isolation
    - Terminal Benchmarking (`/reference/benchmarking`) → `references/docs/reference/benchmarking.mdx` — Run Terminal-Bench benchmarks with the Lattice adapter
    - AGENTS.md (`/AGENTS`) → `references/docs/AGENTS.md` — Agent instructions for AI assistants working on the Lattice codebase
<!-- END DOCS_TREE -->

1. Read the docs navigation (source of truth for which pages exist):

```ts
agent_skill_read_file({ name: "lattice-docs", filePath: "references/docs/docs.json" });
```

2. Read a specific page by path (mirrors `docs/` in the lattice repo):

- `/agents` → `references/docs/agents/index.mdx`
- `/config/models` → `references/docs/config/models.mdx`
- `/runtime` → `references/docs/runtime/index.mdx`

```ts
agent_skill_read_file({
  name: "lattice-docs",
  filePath: "references/docs/config/models.mdx",
});
```

Notes:

- Many pages are `.mdx`; some are `.../index.mdx`.
- Images are not embedded; you may see `/img/...` references.

## When to use

Use this skill when the user asks how lattice works (workspaces, runtimes, agents, models, hooks, keybinds, etc.).

## About

LATTICE RUNTIME- runtime enforcement and identity infrastructure for autonomous ai agents for internal use.
