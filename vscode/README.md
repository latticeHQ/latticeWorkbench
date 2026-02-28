# lattice VS Code Extension

Open [lattice](https://latticeruntime.com) workspaces from VS Code or Cursor.

## Installation

Download the latest `.vsix` from [lattice releases](https://github.com/latticeHQ/latticeWorkbench/releases) and install:

```bash
code --install-extension lattice-0.1.0.vsix
```

## Usage

`Cmd+Shift+P` → "lattice: Open Workspace" → Select workspace

## Requirements

**For SSH workspaces**: Install Remote-SSH extension

- **VS Code**: `ms-vscode-remote.remote-ssh`
- **Cursor**: `anysphere.remote-ssh`

SSH hosts must be configured in `~/.ssh/config`.

## Development

```bash
cd vscode
npm install
npm run compile  # Build
npm run package  # Create .vsix
```

Press `F5` in VS Code to debug.
