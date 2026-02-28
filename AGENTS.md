# Agent Conventions

Instructions for AI agents (Claude, Codex, Gemini, etc.) working on this codebase.

## Branch Naming

Every agent-created branch **must** follow this pattern:

```
{hardware}/worktree-{agent}-{slug}
```

| Segment      | Description                                      | Examples                        |
|--------------|--------------------------------------------------|---------------------------------|
| `hardware`   | Machine the agent is running on                  | `m4` (Mac M4), `i9` (Intel i9) |
| `worktree-`  | Fixed prefix — signals this is an agent worktree  | —                               |
| `agent`      | Short name of the AI tool                        | `claude`, `codex`, `gemini`     |
| `slug`       | Kebab-case task description                      | `fix-auth-bug`, `add-search`    |

### Detecting Hardware

Use the system's chip/processor to determine the hardware prefix:

| Chip / Processor         | Prefix |
|--------------------------|--------|
| Apple M4                 | `m4`   |
| Apple M3                 | `m3`   |
| Apple M2                 | `m2`   |
| Apple M1                 | `m1`   |
| Intel Core i9            | `i9`   |
| Intel Core i7            | `i7`   |
| AMD Ryzen 9              | `r9`   |
| Cloud / unknown          | `cloud`|

On macOS: `sysctl -n machdep.cpu.brand_string`
On Linux: `lscpu | grep 'Model name'`

### Agent Short Names

| Tool              | Use    |
|-------------------|--------|
| Claude Code       | `claude` |
| OpenAI Codex      | `codex`  |
| Google Gemini CLI | `gemini` |
| Aider             | `aider`  |
| GitHub Copilot    | `copilot`|
| Amp               | `amp`    |

### Examples

```
m4/worktree-claude-agentic-mode
m4/worktree-codex-fix-login-redirect
m4/worktree-gemini-add-dark-theme
i9/worktree-claude-refactor-api-layer
m3/worktree-aider-update-deps
```

### Why

- **Hardware prefix** — reviewers know which machine produced the change
- **`worktree-` prefix** — instantly identifies agent-created branches vs human branches
- **Agent name** — tracks which AI tool authored the work
- **Slug** — describes the task at a glance

## Commit Messages

- Use conventional commit style: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- Keep the subject line under 72 characters
- Add `Co-Authored-By` trailer for the agent that wrote the code

## Workflow

1. Detect hardware → determine prefix
2. Create branch following the naming pattern
3. Do the work, commit with conventional messages
4. When done, summarize what changed for the reviewer
