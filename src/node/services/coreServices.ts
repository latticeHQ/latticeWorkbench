/**
 * Core service graph shared by `lattice run` (CLI) and `ServiceContainer` (desktop).
 */

import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import type { Config } from "@/node/config";
import { getRealHome } from "@/common/utils/masHome";
import { HistoryService } from "@/node/services/historyService";
import { InitStateManager } from "@/node/services/initStateManager";
import { ProviderService } from "@/node/services/providerService";
import { AIService } from "@/node/services/aiService";
import { BackgroundProcessManager } from "@/node/services/backgroundProcessManager";
import { SessionUsageService } from "@/node/services/sessionUsageService";
import { MCPConfigService } from "@/node/services/mcpConfigService";
import { MCPServerManager, type MCPServerManagerOptions } from "@/node/services/mcpServerManager";
import { ExtensionMetadataService } from "@/node/services/ExtensionMetadataService";
import { MinionService } from "@/node/services/minionService";
import { TaskService } from "@/node/services/taskService";
import type { MinionMcpOverridesService } from "@/node/services/minionMcpOverridesService";
import type { PolicyService } from "@/node/services/policyService";
import type { TelemetryService } from "@/node/services/telemetryService";
import type { ExperimentsService } from "@/node/services/experimentsService";
import type { SessionTimingService } from "@/node/services/sessionTimingService";

export interface CoreServicesOptions {
  config: Config;
  extensionMetadataPath: string;
  /** Overrides config for MCPConfigService; CLI passes its persistent realConfig. */
  mcpConfig?: Config;
  mcpServerManagerOptions?: MCPServerManagerOptions;
  minionMcpOverridesService?: MinionMcpOverridesService;
  /** Optional cross-cutting services (desktop creates before core services). */
  policyService?: PolicyService;
  telemetryService?: TelemetryService;
  experimentsService?: ExperimentsService;
  sessionTimingService?: SessionTimingService;
}

export interface CoreServices {
  historyService: HistoryService;
  initStateManager: InitStateManager;
  providerService: ProviderService;
  backgroundProcessManager: BackgroundProcessManager;
  sessionUsageService: SessionUsageService;
  aiService: AIService;
  mcpConfigService: MCPConfigService;
  mcpServerManager: MCPServerManager;
  extensionMetadata: ExtensionMetadataService;
  minionService: MinionService;
  taskService: TaskService;
}

/**
 * Find a JavaScript runtime (bun or node) accessible from the MAS sandbox.
 *
 * In the MAS sandbox, the only accessible paths are:
 *   - The app's own container (~/.lattice/ inside ~/Library/Containers/...)
 *   - Security-scoped bookmarked paths (typically the user's home directory)
 *   - System paths (/usr/bin, /bin, etc.)
 *
 * bun/node installed under ~ are accessible after the home directory bookmark is granted.
 * System-wide installations (/opt/homebrew, /usr/local) may also be accessible.
 */
function findMasJsRuntime(): { command: string; isBun: boolean } | null {
  const realHome = getRealHome();

  // Prefer bun — recommended for Lattice, typically installed under home directory.
  const bunPath = path.join(realHome, ".bun", "bin", "bun");
  if (existsSync(bunPath)) {
    return { command: bunPath, isBun: true };
  }

  // Try node from home-directory-based version managers (accessible via bookmark).
  const homeNodePaths = [
    path.join(realHome, ".volta", "bin", "node"),
    path.join(realHome, ".nvm", "current", "bin", "node"),
    path.join(realHome, ".local", "bin", "node"),
    path.join(realHome, ".nodenv", "shims", "node"),
  ];
  for (const nodePath of homeNodePaths) {
    if (existsSync(nodePath)) {
      return { command: nodePath, isBun: false };
    }
  }

  // Try system-wide installations — may not be accessible in sandbox without
  // additional bookmarks, but worth checking (stat will return false if blocked).
  const systemPaths = [
    "/opt/homebrew/bin/bun",
    "/opt/homebrew/bin/node",
    "/usr/local/bin/bun",
    "/usr/local/bin/node",
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) {
      return { command: p, isBun: p.endsWith("/bun") };
    }
  }

  return null;
}

/**
 * Built-in MCP servers that ship with Lattice.
 *
 * These are always available in every minion — they cannot be disabled
 * via mcp.jsonc or minion overrides because inline servers take precedence.
 * The lattice MCP server gives agents full control of Lattice itself (minions,
 * projects, terminals, analytics, etc.).
 */
function getBuiltinInlineServers(config?: Config): Record<string, string> {
  // Resolve paths to the bundled MCP servers.
  //
  // Three environments:
  //   1. Dev (unbundled):  __dirname = src/node/services/ → ../../mcp-server/index.ts
  //   2. Dev (compiled):   __dirname = dist/node/services/ → ../../../src/mcp-server/index.ts
  //   3. Packaged Electron: __dirname inside app.asar — src/ doesn't exist in the archive
  //      and Bun can't access files inside .asar anyway.  Use the pre-bundled JS files
  //      in app.asar.unpacked/dist/mcp-server/ instead.
  //
  // Detection: if __dirname contains "app.asar" we're in a packaged Electron app.
  const isPackaged = __dirname.includes(`app.asar${path.sep}`) || __dirname.includes("app.asar/");

  let latticeMcpServerPath: string;
  let notebooklmMcpServerPath: string;

  if (isPackaged) {
    // Packaged Electron: use bundled JS from app.asar.unpacked/dist/
    // Bun subprocess can only read real files, not virtual .asar entries.
    const asarUnpackedRoot = __dirname.split("app.asar")[0] + "app.asar.unpacked";
    latticeMcpServerPath = path.join(asarUnpackedRoot, "dist", "mcp-server", "index.js");
    notebooklmMcpServerPath = path.join(asarUnpackedRoot, "dist", "notebooklm-mcp", "index.js");
  } else {
    // Development: point to .ts source files (Bun runs them natively).
    const inDist = __dirname.includes(`${path.sep}dist${path.sep}`) || __dirname.endsWith(`${path.sep}dist`);
    latticeMcpServerPath = inDist
      ? path.resolve(__dirname, "../../../src/mcp-server/index.ts")
      : path.resolve(__dirname, "../../mcp-server/index.ts");
    notebooklmMcpServerPath = inDist
      ? path.resolve(__dirname, "../../../src/notebooklm-mcp/index.ts")
      : path.resolve(__dirname, "../../notebooklm-mcp/index.ts");
  }

  // Choose the JS runtime for MCP servers:
  //   - MAS sandbox: CANNOT re-execute the Electron binary (ELECTRON_RUN_AS_NODE=1).
  //     The signed binary has entitlements (JIT, unsigned memory, library validation,
  //     DYLD, bookmarks) beyond the two allowed for sandbox child processes
  //     (app-sandbox + inherit). macOS aborts such children → EPERM.
  //     Instead, use bun/node from the user's system, accessible via security-scoped
  //     bookmarks after the home directory grant.
  //   - Non-MAS packaged: prefer bun (faster startup), fall back to node.
  //   - Dev mode: use bun (handles .ts natively).
  let runPrefix: string;
  if (isPackaged && process.mas) {
    const masRuntime = findMasJsRuntime();
    if (masRuntime) {
      runPrefix = masRuntime.isBun
        ? `${JSON.stringify(masRuntime.command)} run`
        : JSON.stringify(masRuntime.command);
    } else {
      // No bun/node found. Log warning — MCP servers will fail to start.
      console.warn(
        "[MAS] No bun or node found in accessible paths. MCP servers will not work. " +
          "Install bun: curl -fsSL https://bun.sh/install | bash"
      );
      // Use a placeholder that will produce a clear error when exec'd.
      runPrefix = "echo 'Error: No JavaScript runtime (bun/node) found for MCP servers.' && exit 1 #";
    }
  } else {
    runPrefix = "bun run";
  }

  const servers: Record<string, string> = {
    lattice: `${runPrefix} ${latticeMcpServerPath}`,
  };

  // NotebookLM: built-in but toggleable via config (default: enabled).
  const nlmEnabled = config?.loadConfigOrDefault().notebooklm?.enabled ?? true;
  if (nlmEnabled) {
    servers.notebooklm = `${runPrefix} ${notebooklmMcpServerPath}`;
  }

  return servers;
}

export function createCoreServices(opts: CoreServicesOptions): CoreServices {
  const { config, extensionMetadataPath } = opts;

  const historyService = new HistoryService(config);
  const initStateManager = new InitStateManager(config);
  const providerService = new ProviderService(config, opts.policyService);
  const backgroundProcessManager = new BackgroundProcessManager(
    path.join(os.tmpdir(), "lattice-bashes")
  );
  const sessionUsageService = new SessionUsageService(config, historyService);

  const aiService = new AIService(
    config,
    historyService,
    initStateManager,
    providerService,
    backgroundProcessManager,
    sessionUsageService,
    opts.minionMcpOverridesService,
    opts.policyService,
    opts.telemetryService
  );

  // MCP: merge built-in inline servers with any caller-provided ones.
  // Built-in servers are always present; caller-provided ones can add more
  // but cannot remove built-ins (inline servers override config, not vice versa).
  const builtinInlineServers = getBuiltinInlineServers(config);
  const mergedMcpOptions: MCPServerManagerOptions = {
    ...opts.mcpServerManagerOptions,
    inlineServers: {
      ...builtinInlineServers,
      ...(opts.mcpServerManagerOptions?.inlineServers ?? {}),
    },
  };

  const mcpConfigService = new MCPConfigService(opts.mcpConfig ?? config);
  const mcpServerManager = new MCPServerManager(
    mcpConfigService,
    mergedMcpOptions,
    opts.policyService
  );
  aiService.setMCPServerManager(mcpServerManager);

  const extensionMetadata = new ExtensionMetadataService(extensionMetadataPath);

  const minionService = new MinionService(
    config,
    historyService,
    aiService,
    initStateManager,
    extensionMetadata,
    backgroundProcessManager,
    sessionUsageService,
    opts.policyService,
    opts.telemetryService,
    opts.experimentsService,
    opts.sessionTimingService
  );
  minionService.setMCPServerManager(mcpServerManager);

  const taskService = new TaskService(
    config,
    historyService,
    aiService,
    minionService,
    initStateManager
  );
  aiService.setTaskService(taskService);
  minionService.setTaskService(taskService);

  return {
    historyService,
    initStateManager,
    providerService,
    backgroundProcessManager,
    sessionUsageService,
    aiService,
    mcpConfigService,
    mcpServerManager,
    extensionMetadata,
    minionService,
    taskService,
  };
}
