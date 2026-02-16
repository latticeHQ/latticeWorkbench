/**
 * CLI Agent Definitions - Registry of external CLI coding agents.
 *
 * This is the single source of truth for all CLI agents that Lattice Workbench
 * can detect and orchestrate. Agents are discovered via binary detection on the
 * system PATH or known installation locations.
 *
 * When adding a new CLI agent:
 * 1. Add entry to CLI_AGENT_DEFINITIONS below
 * 2. Add SVG icon + import in src/browser/components/CliAgentIcon.tsx
 */

export interface CliAgentDefinition {
  /** Display name for UI (proper casing) */
  displayName: string;
  /** Short description of the agent */
  description: string;
  /** Binary names to check via `which` (checked in order, first found wins) */
  binaryNames: string[];
  /** Additional macOS-specific paths to check */
  macPaths?: string[];
  /** URL to installation docs */
  installUrl: string;
  /** Quick install command (e.g., `npm install -g ...`) */
  installCommand?: string;
  /** Detection category */
  category: "cli" | "vscode-extension" | "app";
  /** For GitHub CLI extensions, the extension name (e.g., "copilot") */
  ghExtension?: string;
  /** Known model IDs this provider supports (for model picker integration) */
  supportedModels?: string[];

  // ── Execution metadata (for LanguageModelV2 provider) ──

  /** Output format the CLI produces. "stream-json" for Claude's structured events, "text" for plain stdout. Default: "text" */
  outputFormat?: "stream-json" | "text";
  /** Flag used to pass the prompt (e.g., "-p", "--prompt"). undefined = positional argument */
  promptFlag?: string;
  /** Flag used to select the model (e.g., "--model"). undefined = agent picks its own */
  modelFlag?: string;
  /** Extra CLI arguments appended to every invocation */
  extraArgs?: string[];
  /** Whether the agent supports tool calls in its output */
  supportsToolCalls?: boolean;
  /** Whether the agent supports reasoning/thinking output */
  supportsReasoning?: boolean;

  // ── Health check metadata ──

  /** Args to run a minimal health probe (e.g., ["-p", "say ok"]). If undefined, health is "unknown". */
  healthCheckArgs?: string[];
  /** Timeout for health check in ms. Default: 15000 */
  healthCheckTimeoutMs?: number;
}

// Order determines display order in UI (detected agents sorted to top)
export const CLI_AGENT_DEFINITIONS = {
  "claude-code": {
    displayName: "Claude Code",
    description: "Anthropic's agentic coding tool",
    binaryNames: ["claude"],
    macPaths: [
      "${HOME}/.local/bin/claude",
      "/usr/local/bin/claude",
      "${HOME}/.npm-global/bin/claude",
      "${HOME}/.volta/bin/claude",
      "${HOME}/.nvm/current/bin/claude",
    ],
    installUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
    installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
    category: "cli" as const,
    supportedModels: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    outputFormat: "stream-json",
    promptFlag: "-p",
    modelFlag: "--model",
    extraArgs: [
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      "1",
      "--no-session-persistence",
    ],
    supportsToolCalls: true,
    supportsReasoning: true,
    healthCheckArgs: ["-p", "say ok", "--output-format", "json", "--max-turns", "1"],
    healthCheckTimeoutMs: 30000,
  },
  codex: {
    displayName: "Codex",
    description: "OpenAI's CLI coding agent",
    binaryNames: ["codex"],
    macPaths: [
      "${HOME}/.volta/bin/codex",
      "${HOME}/.nvm/current/bin/codex",
      "${HOME}/.npm-global/bin/codex",
      "/usr/local/bin/codex",
    ],
    installUrl: "https://github.com/openai/codex",
    installCommand: "npm install -g @openai/codex",
    category: "cli" as const,
    supportedModels: ["gpt-5.2-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5.1-codex-max"],
    outputFormat: "text",
    promptFlag: "--prompt",
    modelFlag: "--model",
    healthCheckArgs: ["--help"],
    healthCheckTimeoutMs: 10000,
  },
  gemini: {
    displayName: "Gemini",
    description: "Google's CLI coding agent",
    binaryNames: ["gemini"],
    macPaths: [
      "${HOME}/.volta/bin/gemini",
      "${HOME}/.nvm/current/bin/gemini",
      "${HOME}/.npm-global/bin/gemini",
      "/usr/local/bin/gemini",
    ],
    installUrl: "https://github.com/google-gemini/gemini-cli",
    installCommand: "npm install -g @google/gemini-cli",
    category: "cli" as const,
    supportedModels: ["gemini-3-pro-preview", "gemini-3-flash-preview"],
    outputFormat: "text",
    promptFlag: "-p",
    healthCheckArgs: ["--help"],
    healthCheckTimeoutMs: 10000,
  },
  amp: {
    displayName: "Amp",
    description: "Sourcegraph's AI coding agent",
    binaryNames: ["amp"],
    installUrl: "https://ampcode.com",
    installCommand: "npm install -g @sourcegraph/amp@latest",
    category: "cli" as const,
  },
  auggie: {
    displayName: "Auggie",
    description: "Augment Code's AI pair programming assistant",
    binaryNames: ["auggie"],
    installUrl: "https://www.augmentcode.com",
    installCommand: "npm install -g @augmentcode/auggie",
    category: "cli" as const,
  },
  cline: {
    displayName: "Cline",
    description: "Autonomous coding agent",
    binaryNames: ["cline"],
    installUrl: "https://github.com/cline/cline",
    installCommand: "npm install -g cline",
    category: "cli" as const,
  },
  codebuff: {
    displayName: "Codebuff",
    description: "AI code generation tool",
    binaryNames: ["codebuff", "cb"],
    installUrl: "https://codebuff.com",
    installCommand: "npm install -g codebuff",
    category: "cli" as const,
  },
  continue: {
    displayName: "Continue",
    description: "Open-source AI code assistant",
    binaryNames: ["cn", "continue"],
    installUrl: "https://continue.dev",
    installCommand: "npm i -g @continuedev/cli",
    category: "cli" as const,
  },
  cursor: {
    displayName: "Cursor",
    description: "AI-first code editor",
    binaryNames: ["cursor"],
    macPaths: [
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "/usr/local/bin/cursor",
    ],
    installUrl: "https://cursor.com",
    installCommand: "curl https://cursor.com/install -fsS | bash",
    category: "app" as const,
  },
  droid: {
    displayName: "Droid",
    description: "Factory's AI software engineer agent",
    binaryNames: ["droid"],
    installUrl: "https://droid.dev",
    installCommand: "curl -fsSL https://app.factory.ai/cli | bash",
    category: "cli" as const,
  },
  "github-copilot": {
    displayName: "GitHub Copilot",
    description: "GitHub's AI coding assistant",
    binaryNames: ["copilot", "gh"],
    ghExtension: "copilot",
    installUrl: "https://github.com/features/copilot",
    installCommand: "npm install -g @github/copilot",
    category: "cli" as const,
    supportedModels: ["claude-sonnet-4.5", "gpt-4o"],
    outputFormat: "text",
    // Uses `gh copilot suggest -t shell <prompt>` — prompt is positional
  },
  goose: {
    displayName: "Goose",
    description: "Block's open-source AI developer agent",
    binaryNames: ["goose"],
    installUrl: "https://github.com/block/goose",
    installCommand:
      "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash",
    category: "cli" as const,
  },
  kilocode: {
    displayName: "Kilocode",
    description: "AI coding assistant",
    binaryNames: ["kilocode", "kilo"],
    installUrl: "https://kilocode.ai",
    installCommand: "npm install -g @kilocode/cli",
    category: "cli" as const,
  },
  kimi: {
    displayName: "Kimi",
    description: "Moonshot AI's coding agent",
    binaryNames: ["kimi"],
    installUrl: "https://kimi.ai",
    installCommand: "uv tool install --python 3.13 kimi-cli",
    category: "cli" as const,
  },
  kiro: {
    displayName: "Kiro (AWS)",
    description: "AWS's AI development environment",
    binaryNames: ["kiro"],
    installUrl: "https://kiro.dev",
    installCommand: "curl -fsSL https://cli.kiro.dev/install | bash",
    category: "app" as const,
  },
  "mistral-vibe": {
    displayName: "Mistral Vibe",
    description: "Mistral's agentic coding tool",
    binaryNames: ["vibe"],
    installUrl: "https://mistral.ai/products/vibe",
    installCommand: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
    category: "cli" as const,
    supportedModels: ["devstral-2", "codestral"],
    outputFormat: "text",
    // Prompt is positional: `vibe "prompt here"`
  },
  opencode: {
    displayName: "OpenCode",
    description: "Open-source AI coding agent",
    binaryNames: ["opencode"],
    installUrl: "https://github.com/opencode-ai/opencode",
    installCommand: "npm install -g opencode-ai",
    category: "cli" as const,
  },
  pi: {
    displayName: "Pi",
    description: "Lightweight AI coding agent",
    binaryNames: ["pi"],
    installUrl: "https://github.com/mariozechner/pi-coding-agent",
    installCommand: "npm install -g @mariozechner/pi-coding-agent",
    category: "cli" as const,
  },
  "qwen-code": {
    displayName: "Qwen Code",
    description: "Alibaba's AI coding agent",
    binaryNames: ["qwen", "qwen-code"],
    installUrl: "https://github.com/QwenLM/qwen-code",
    installCommand: "npm install -g @qwen-code/qwen-code",
    category: "cli" as const,
  },
  "rovo-dev": {
    displayName: "Rovo Dev",
    description: "Atlassian's AI developer agent",
    binaryNames: ["acli"],
    installUrl: "https://www.atlassian.com/software/rovo",
    installCommand: "brew tap atlassian/homebrew-acli && brew install acli",
    category: "cli" as const,
  },
} as const satisfies Record<string, CliAgentDefinition>;

/**
 * Union type of all CLI agent slugs
 */
export type CliAgentSlug = keyof typeof CLI_AGENT_DEFINITIONS;

/**
 * Array of all CLI agent slugs (for iteration)
 */
export const CLI_AGENT_SLUGS = Object.keys(CLI_AGENT_DEFINITIONS) as CliAgentSlug[];

/**
 * Display names for CLI agents (proper casing for UI)
 */
export const CLI_AGENT_DISPLAY_NAMES: Record<CliAgentSlug, string> = Object.fromEntries(
  Object.entries(CLI_AGENT_DEFINITIONS).map(([key, def]) => [key, def.displayName])
) as Record<CliAgentSlug, string>;
