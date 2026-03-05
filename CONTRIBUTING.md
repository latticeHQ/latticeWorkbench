# Contributing to Lattice

## Prerequisites

- **Node.js** 20+
- **bun** (package manager & runtime)
- **pnpm** (for lockfile compatibility)
- **Make** (build orchestration)
- **Electron** (optional dependency, installed automatically)

## Setup

```bash
git clone https://github.com/latticeHQ/latticeWorkbench.git
cd latticeWorkbench
bun install
make dev
```

## Development

| Command | Description |
|---------|-------------|
| `make dev` | Start Electron in development mode with hot reload |
| `make build` | Production build (main + renderer + preload) |
| `make typecheck` | Run TypeScript type checking |
| `make lint` | Lint with ESLint |
| `make lint-fix` | Auto-fix lint issues |
| `make fmt` | Format with Prettier |
| `make test` | Run unit tests (Jest) |
| `make test-e2e` | Run end-to-end tests (Playwright) |
| `make storybook` | Start Storybook for component development |

## Branch Naming

- `feat/<description>` — new features
- `fix/<description>` — bug fixes
- `refactor/<description>` — code restructuring
- `docs/<description>` — documentation changes

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new feature
fix(scope): resolve bug description
refactor(scope): restructure without behavior change
docs(scope): update documentation
```

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Write or update tests for your changes
3. Run `make lint && make test` before submitting
4. Keep PRs focused — one feature or fix per PR
5. Update `CHANGELOG.md` under `[Unreleased]` if the change is user-facing

## Code Style

- TypeScript strict mode
- ESLint + Prettier enforced (see `.eslintrc` and `.prettierrc`)
- Tailwind CSS for styling (v4)
- React 18 with function components and hooks

## Architecture

```
src/
  browser/    # Renderer process (React UI)
  desktop/    # Main Electron process
  cli/        # CLI entry point
  common/     # Shared types, constants, utilities
  node/       # Node.js services (agents, MCP, terminals)
  mcp-server/ # Built-in MCP server
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
