/**
 * Terminal Profile Definitions - Single source of truth for known CLI tool profiles
 *
 * When adding a new profile:
 * 1. Add entry to TERMINAL_PROFILE_DEFINITIONS below
 * 2. Detection uses commandDiscovery.ts (isCommandAvailable) automatically
 * 3. Install recipes are per-runtime (local, SSH, Docker)
 *
 * Profile order determines display order in Settings UI and "+" dropdown.
 */

/** Install recipe for a specific package manager */
export interface InstallRecipe {
  /** Package manager method */
  method: "npm" | "pip" | "brew" | "curl" | "gh-extension";
  /** Full command string to run in a terminal */
  command: string;
  /** Whether the command may need sudo */
  requiresSudo?: boolean;
}

/** Install recipes grouped by runtime type */
export interface InstallRecipes {
  /** Local/worktree installs — array allows multiple options (npm, brew, pip) */
  local?: InstallRecipe[];
  /** SSH runtime — typically same as local but may differ */
  ssh?: InstallRecipe[];
  /** Docker runtime — install script or image reference */
  docker?: InstallRecipe[];
}

export interface TerminalProfileDefinition {
  /** Stable identifier (kebab-case, e.g. "claude-code") */
  id: string;
  /** Display name for UI (e.g. "Claude Code") */
  displayName: string;
  /** Primary command name for detection via `which` */
  command: string;
  /** Default arguments when launching the CLI */
  defaultArgs?: string[];
  /** Short description shown in settings UI */
  description: string;
  /** Install recipes per runtime type */
  install: InstallRecipes;
  /** Alternative command names to probe (checked in order after primary) */
  commandAliases?: string[];
  /** Known absolute paths to check on macOS (skip `which` overhead) */
  knownPaths?: string[];
  /** Grouping category for UI display */
  category: "ai-agent" | "shell" | "tool";
  /** Crew group — "platform" for major vendors, "community" for open-source/indie */
  group: "platform" | "community";
}

// Order determines display order in Settings UI and "+" dropdown.
export const TERMINAL_PROFILE_DEFINITIONS: Record<string, TerminalProfileDefinition> = {
  "claude-code": {
    id: "claude-code",
    displayName: "Anthropic Claude Code",
    command: "claude",
    description: "Anthropic's agentic coding assistant",
    category: "ai-agent",
    group: "platform",
    commandAliases: ["claude-code"],
    knownPaths: ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"],
    install: {
      local: [{ method: "npm", command: "npm install -g @anthropic-ai/claude-code" }],
      ssh: [{ method: "npm", command: "npm install -g @anthropic-ai/claude-code" }],
    },
  },
  "gemini-cli": {
    id: "gemini-cli",
    displayName: "Google Gemini",
    command: "gemini",
    description: "Google's Gemini command-line interface",
    category: "ai-agent",
    group: "platform",
    knownPaths: ["/usr/local/bin/gemini", "/opt/homebrew/bin/gemini"],
    install: {
      local: [{ method: "npm", command: "npm install -g @google/gemini-cli" }],
    },
  },
  "github-copilot": {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    // GitHub Copilot CLI is a gh extension; the command is "gh copilot"
    // but detection should check for `gh` first, then `gh extension list` for copilot
    command: "gh",
    defaultArgs: ["copilot"],
    description: "GitHub Copilot in the terminal via gh CLI extension",
    category: "ai-agent",
    group: "platform",
    install: {
      local: [{ method: "gh-extension", command: "gh extension install github/gh-copilot" }],
    },
  },
  aider: {
    id: "aider",
    displayName: "Aider",
    command: "aider",
    description: "AI pair programming in your terminal",
    category: "ai-agent",
    group: "community",
    knownPaths: ["/usr/local/bin/aider", "/opt/homebrew/bin/aider"],
    install: {
      local: [
        { method: "pip", command: "pip install aider-chat" },
        { method: "brew", command: "brew install aider" },
      ],
      ssh: [{ method: "pip", command: "pip install aider-chat" }],
    },
  },
  codex: {
    id: "codex",
    displayName: "OpenAI Codex",
    command: "codex",
    description: "OpenAI's coding agent CLI",
    category: "ai-agent",
    group: "platform",
    install: {
      local: [{ method: "npm", command: "npm install -g @openai/codex" }],
    },
  },
  amp: {
    id: "amp",
    displayName: "Sourcegraph Amp",
    command: "amp",
    description: "Sourcegraph's AI coding agent",
    category: "ai-agent",
    group: "community",
    install: {
      local: [{ method: "npm", command: "npm install -g @anthropic-ai/amp" }],
    },
  },
  exo: {
    id: "exo",
    displayName: "Exo Cluster",
    command: "uv",
    defaultArgs: ["run", "exo"],
    description: "Run distributed AI inference cluster via exo (exo-explore)",
    category: "tool",
    group: "community",
    knownPaths: [
      "~/.exo-cluster/pyproject.toml",
    ],
    install: {
      local: [
        { method: "curl", command: "git clone https://github.com/exo-explore/exo.git ~/.exo-cluster && cd ~/.exo-cluster/dashboard && npm install && npm run build" },
      ],
    },
  },
} as const satisfies Record<string, TerminalProfileDefinition>;

/** Ordered list of known profile IDs (display order) */
export const KNOWN_PROFILE_IDS = Object.keys(TERMINAL_PROFILE_DEFINITIONS);

/** Type-safe profile ID */
export type KnownProfileId = keyof typeof TERMINAL_PROFILE_DEFINITIONS;

/**
 * Get a profile definition by ID.
 * Returns undefined for unknown/custom profiles.
 */
export function getProfileDefinition(id: string): TerminalProfileDefinition | undefined {
  return TERMINAL_PROFILE_DEFINITIONS[id];
}
