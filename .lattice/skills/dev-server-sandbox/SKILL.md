---
name: dev-server-sandbox
description: Run multiple isolated lattice dev-server instances (temp LATTICE_ROOT + free ports)
---

# `dev-server` sandbox instances

`make dev-server` starts the lattice backend server, which uses a lockfile at:

- `<LATTICE_ROOT>/server.lock` (defaults to `~/.lattice-dev/server.lock` in development)

This means you can only run **one** dev server per lattice root directory.

This skill documents the repo workflow for starting **multiple** dev-server instances in parallel (including from different git worktrees) by giving each instance its own temporary `LATTICE_ROOT`.

## Quick start

```bash
make dev-server-sandbox
```

## What it does

- Creates a fresh temporary `LATTICE_ROOT` directory
- Copies these files into the sandbox if present (unless disabled by flags):
  - `providers.jsonc` (provider config)
  - `config.json` (project list)
- Picks free ports (`BACKEND_PORT`, `VITE_PORT`)
- Allows all hosts (`VITE_ALLOWED_HOSTS=all`) so it works behind port-forwarding domains
- Runs `make dev-server` with those env overrides

## Options

```bash
# Start with a clean instance (do not copy providers or projects)
make dev-server-sandbox DEV_SERVER_SANDBOX_ARGS="--clean-providers --clean-projects"

# Skip copying providers.jsonc
make dev-server-sandbox DEV_SERVER_SANDBOX_ARGS="--clean-providers"

# Clear projects from config.json (preserves other config)
make dev-server-sandbox DEV_SERVER_SANDBOX_ARGS="--clean-projects"

# Use a specific root to seed from (defaults to ~/.lattice-dev then ~/.lattice)
SEED_LATTICE_ROOT=~/.lattice-dev make dev-server-sandbox

# Keep the sandbox root directory after exit (useful for debugging)
KEEP_SANDBOX=1 make dev-server-sandbox

# Pin ports (must be different)
BACKEND_PORT=3001 VITE_PORT=5174 make dev-server-sandbox

# Override which make binary to use
MAKE=gmake make dev-server-sandbox
```

## Security notes

- `providers.jsonc` may contain API keys.
- The sandbox root directory is created on disk (usually under your system temp dir).
- This flow intentionally **does not** copy `secrets.json`.
