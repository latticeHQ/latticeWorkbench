# Development Environment Setup Log

## Date: 2026-03-07

### 1. SSH Key (Ed25519)
- **Generated:** `~/.ssh/id_ed25519`
- **Email:** onchainengineer@gmail.com
- **Added to GitHub** via `gh ssh-key add`
- **GitHub host key** added to `~/.ssh/known_hosts`
- Repo remote switched from HTTPS to SSH: `git@github.com:latticeHQ/latticeWorkbench.git`

### 2. Homebrew
- **Installed:** Homebrew 5.0.16
- **Path:** `/opt/homebrew/bin/brew`
- **Shell config:** Added `eval "$(/opt/homebrew/bin/brew shellenv)"` to `~/.zprofile`

### 3. GitHub CLI (`gh`)
- **Installed via:** `brew install gh` (v2.87.3)
- **Authenticated:** account `onchainengineer`, protocol SSH
- **Token scopes:** `admin:public_key`, `gist`, `read:org`, `repo`

### 4. Volta (JavaScript Tool Manager)
- **Installed:** v2.0.2
- **Path:** `~/.volta/bin`
- **Shell config:** Auto-added to `~/.zshrc` by installer

### 5. Node.js (via Volta)
- **Installed:** v24.14.0
- **Managed by:** Volta (`volta install node`)

### 6. pnpm (via Volta)
- **Installed:** v10.30.3
- **Managed by:** Volta (`volta install pnpm`)
- **Project deps:** `pnpm install` completed (2057 packages)
