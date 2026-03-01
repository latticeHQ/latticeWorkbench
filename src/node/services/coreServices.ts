/**
 * Core service graph shared by `lattice run` (CLI) and `ServiceContainer` (desktop).
 */

import * as os from "os";
import * as path from "path";
import type { Config } from "@/node/config";
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
 * Built-in MCP servers that ship with Lattice.
 *
 * These are always available in every minion — they cannot be disabled
 * via mcp.jsonc or minion overrides because inline servers take precedence.
 * The lattice MCP server gives agents full control of Lattice itself (minions,
 * projects, terminals, analytics, etc.).
 */
function getBuiltinInlineServers(config?: Config): Record<string, string> {
  // Resolve path to the bundled lattice MCP server.
  // In dev:   __dirname = src/node/services/  → ../../mcp-server/ = src/mcp-server/
  // In build: __dirname = dist/node/services/ → ../../../src/mcp-server/ (back to source)
  // Bun can run .ts files natively, so we always point to the source .ts file.
  const inDist = __dirname.includes(`${path.sep}dist${path.sep}`) || __dirname.endsWith(`${path.sep}dist`);
  const latticeMcpServerPath = inDist
    ? path.resolve(__dirname, "../../../src/mcp-server/index.ts")
    : path.resolve(__dirname, "../../mcp-server/index.ts");

  const servers: Record<string, string> = {
    lattice: `bun run ${latticeMcpServerPath}`,
  };

  // NotebookLM: built-in but toggleable via config (default: enabled).
  const nlmEnabled = config?.loadConfigOrDefault().notebooklm?.enabled ?? true;
  if (nlmEnabled) {
    const notebooklmMcpServerPath = inDist
      ? path.resolve(__dirname, "../../../src/notebooklm-mcp/index.ts")
      : path.resolve(__dirname, "../../notebooklm-mcp/index.ts");
    servers.notebooklm = `bun run ${notebooklmMcpServerPath}`;
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
