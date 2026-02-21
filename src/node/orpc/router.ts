import { os } from "@orpc/server";
import { z } from "zod";
import * as schemas from "@/common/orpc/schemas";
import type { ORPCContext } from "./context";
import {
  selectModelForNameGeneration,
  generateWorkspaceIdentity,
} from "@/node/services/workspaceTitleGenerator";
import type {
  UpdateStatus,
  WorkspaceActivitySnapshot,
  WorkspaceChatMessage,
  WorkspaceStatsSnapshot,
  FrontendWorkspaceMetadataSchemaType,
} from "@/common/orpc/types";
import { createAuthMiddleware } from "./authMiddleware";
import { createAsyncMessageQueue } from "@/common/utils/asyncMessageQueue";

import { createRuntime, checkRuntimeAvailability } from "@/node/runtime/runtimeFactory";
import { createRuntimeForWorkspace } from "@/node/runtime/runtimeHelpers";
import { readPlanFile } from "@/node/utils/runtime/helpers";
import { secretsToRecord } from "@/common/types/secrets";
import { roundToBase2 } from "@/common/telemetry/utils";
import { asyncEventIterator, createAsyncEventQueue } from "@/common/utils/asyncEventIterator";
import {
  DEFAULT_LAYOUT_PRESETS_CONFIG,
  isLayoutPresetsConfigEmpty,
  normalizeLayoutPresetsConfig,
} from "@/common/types/uiLayouts";
import { normalizeAgentAiDefaults } from "@/common/types/agentAiDefaults";
import {
  DEFAULT_TASK_SETTINGS,
  normalizeSubagentAiDefaults,
  normalizeTaskSettings,
} from "@/common/types/tasks";
import {
  discoverAgentSkills,
  readAgentSkill,
} from "@/node/services/agentSkills/agentSkillsService";
import {
  discoverAgentDefinitions,
  readAgentDefinition,
} from "@/node/services/agentDefinitions/agentDefinitionsService";
import { resolveAgentInheritanceChain } from "@/node/services/agentDefinitions/resolveAgentInheritanceChain";
import { isWorkspaceArchived } from "@/common/utils/archive";
import type { ChannelMessage } from "@/common/orpc/schemas/channels";

/**
 * Resolves runtime and discovery path for agent operations.
 * - When workspaceId is provided: uses workspace's runtime config (SSH, local, worktree)
 * - When only projectPath is provided: uses local runtime with project path
 * - When disableWorkspaceAgents is true: still uses workspace runtime but discovers from projectPath
 */
async function resolveAgentDiscoveryContext(
  context: ORPCContext,
  input: { projectPath?: string; workspaceId?: string; disableWorkspaceAgents?: boolean }
): Promise<{ runtime: ReturnType<typeof createRuntime>; discoveryPath: string }> {
  if (!input.projectPath && !input.workspaceId) {
    throw new Error("Either projectPath or workspaceId must be provided");
  }

  if (input.workspaceId) {
    const metadataResult = await context.aiService.getWorkspaceMetadata(input.workspaceId);
    if (!metadataResult.success) {
      throw new Error(metadataResult.error);
    }
    const metadata = metadataResult.data;
    const runtime = createRuntimeForWorkspace(metadata);
    // When workspace agents disabled, discover from project path instead of worktree
    // (but still use the workspace's runtime for SSH compatibility)
    const discoveryPath = input.disableWorkspaceAgents
      ? metadata.projectPath
      : runtime.getWorkspacePath(metadata.projectPath, metadata.name);
    return { runtime, discoveryPath };
  }

  // No workspace - use local runtime with project path
  const runtime = createRuntime(
    { type: "local", srcBaseDir: context.config.srcDir },
    { projectPath: input.projectPath! }
  );
  return { runtime, discoveryPath: input.projectPath! };
}

export const router = (authToken?: string) => {
  const t = os.$context<ORPCContext>().use(createAuthMiddleware(authToken));

  return t.router({
    tokenizer: {
      countTokens: t
        .input(schemas.tokenizer.countTokens.input)
        .output(schemas.tokenizer.countTokens.output)
        .handler(async ({ context, input }) => {
          return context.tokenizerService.countTokens(input.model, input.text);
        }),
      countTokensBatch: t
        .input(schemas.tokenizer.countTokensBatch.input)
        .output(schemas.tokenizer.countTokensBatch.output)
        .handler(async ({ context, input }) => {
          return context.tokenizerService.countTokensBatch(input.model, input.texts);
        }),
      calculateStats: t
        .input(schemas.tokenizer.calculateStats.input)
        .output(schemas.tokenizer.calculateStats.output)
        .handler(async ({ context, input }) => {
          return context.tokenizerService.calculateStats(
            input.workspaceId,
            input.messages,
            input.model
          );
        }),
    },
    splashScreens: {
      getViewedSplashScreens: t
        .input(schemas.splashScreens.getViewedSplashScreens.input)
        .output(schemas.splashScreens.getViewedSplashScreens.output)
        .handler(({ context }) => {
          const config = context.config.loadConfigOrDefault();
          return config.viewedSplashScreens ?? [];
        }),
      markSplashScreenViewed: t
        .input(schemas.splashScreens.markSplashScreenViewed.input)
        .output(schemas.splashScreens.markSplashScreenViewed.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            const viewed = config.viewedSplashScreens ?? [];
            if (!viewed.includes(input.splashId)) {
              viewed.push(input.splashId);
            }
            return {
              ...config,
              viewedSplashScreens: viewed,
            };
          });
        }),
    },
    server: {
      getLaunchProject: t
        .input(schemas.server.getLaunchProject.input)
        .output(schemas.server.getLaunchProject.output)
        .handler(async ({ context }) => {
          return context.serverService.getLaunchProject();
        }),
      getSshHost: t
        .input(schemas.server.getSshHost.input)
        .output(schemas.server.getSshHost.output)
        .handler(({ context }) => {
          return context.serverService.getSshHost() ?? null;
        }),
      setSshHost: t
        .input(schemas.server.setSshHost.input)
        .output(schemas.server.setSshHost.output)
        .handler(async ({ context, input }) => {
          // Update in-memory value
          context.serverService.setSshHost(input.sshHost ?? undefined);
          // Persist to config file
          await context.config.editConfig((config) => ({
            ...config,
            serverSshHost: input.sshHost ?? undefined,
          }));
        }),
      getApiServerStatus: t
        .input(schemas.server.getApiServerStatus.input)
        .output(schemas.server.getApiServerStatus.output)
        .handler(({ context }) => {
          const config = context.config.loadConfigOrDefault();
          const configuredBindHost = config.apiServerBindHost ?? null;
          const configuredServeWebUi = config.apiServerServeWebUi === true;
          const configuredPort = config.apiServerPort ?? null;

          const info = context.serverService.getServerInfo();

          return {
            running: info !== null,
            baseUrl: info?.baseUrl ?? null,
            bindHost: info?.bindHost ?? null,
            port: info?.port ?? null,
            networkBaseUrls: info?.networkBaseUrls ?? [],
            token: info?.token ?? null,
            configuredBindHost,
            configuredPort,
            configuredServeWebUi,
          };
        }),
      setApiServerSettings: t
        .input(schemas.server.setApiServerSettings.input)
        .output(schemas.server.setApiServerSettings.output)
        .handler(async ({ context, input }) => {
          const prevConfig = context.config.loadConfigOrDefault();
          const prevBindHost = prevConfig.apiServerBindHost;
          const prevServeWebUi = prevConfig.apiServerServeWebUi;
          const prevPort = prevConfig.apiServerPort;
          const wasRunning = context.serverService.isServerRunning();

          const bindHost = input.bindHost?.trim() ? input.bindHost.trim() : undefined;
          const serveWebUi =
            input.serveWebUi === undefined
              ? prevServeWebUi
              : input.serveWebUi === true
                ? true
                : undefined;
          const port = input.port === null || input.port === 0 ? undefined : input.port;

          if (wasRunning) {
            await context.serverService.stopServer();
          }

          await context.config.editConfig((config) => {
            config.apiServerServeWebUi = serveWebUi;
            config.apiServerBindHost = bindHost;
            config.apiServerPort = port;
            return config;
          });

          if (process.env.LATTICE_NO_API_SERVER !== "1") {
            const authToken = context.serverService.getApiAuthToken();
            if (!authToken) {
              throw new Error("API server auth token not initialized");
            }

            const envPort = process.env.LATTICE_SERVER_PORT
              ? Number.parseInt(process.env.LATTICE_SERVER_PORT, 10)
              : undefined;
            const portToUse = envPort ?? port ?? 0;
            const hostToUse = bindHost ?? "127.0.0.1";

            try {
              await context.serverService.startServer({
                latticeHome: context.config.rootDir,
                context,
                authToken,
                serveStatic: serveWebUi === true,
                host: hostToUse,
                port: portToUse,
              });
            } catch (error) {
              await context.config.editConfig((config) => {
                config.apiServerServeWebUi = prevServeWebUi;
                config.apiServerBindHost = prevBindHost;
                config.apiServerPort = prevPort;
                return config;
              });

              if (wasRunning) {
                const portToRestore = envPort ?? prevPort ?? 0;
                const hostToRestore = prevBindHost ?? "127.0.0.1";

                try {
                  await context.serverService.startServer({
                    latticeHome: context.config.rootDir,
                    context,
                    serveStatic: prevServeWebUi === true,
                    authToken,
                    host: hostToRestore,
                    port: portToRestore,
                  });
                } catch {
                  // Best effort - we'll surface the original error.
                }
              }

              throw error;
            }
          }

          const nextConfig = context.config.loadConfigOrDefault();
          const configuredBindHost = nextConfig.apiServerBindHost ?? null;
          const configuredServeWebUi = nextConfig.apiServerServeWebUi === true;
          const configuredPort = nextConfig.apiServerPort ?? null;

          const info = context.serverService.getServerInfo();

          return {
            running: info !== null,
            baseUrl: info?.baseUrl ?? null,
            bindHost: info?.bindHost ?? null,
            port: info?.port ?? null,
            networkBaseUrls: info?.networkBaseUrls ?? [],
            token: info?.token ?? null,
            configuredBindHost,
            configuredPort,
            configuredServeWebUi,
          };
        }),
    },
    features: {
      getStatsTabState: t
        .input(schemas.features.getStatsTabState.input)
        .output(schemas.features.getStatsTabState.output)
        .handler(async ({ context }) => {
          const state = await context.featureFlagService.getStatsTabState();
          context.sessionTimingService.setStatsTabState(state);
          return state;
        }),
      setStatsTabOverride: t
        .input(schemas.features.setStatsTabOverride.input)
        .output(schemas.features.setStatsTabOverride.output)
        .handler(async ({ context, input }) => {
          const state = await context.featureFlagService.setStatsTabOverride(input.override);
          context.sessionTimingService.setStatsTabState(state);
          return state;
        }),
    },
    config: {
      getConfig: t
        .input(schemas.config.getConfig.input)
        .output(schemas.config.getConfig.output)
        .handler(({ context }) => {
          const config = context.config.loadConfigOrDefault();
          return {
            taskSettings: config.taskSettings ?? DEFAULT_TASK_SETTINGS,
            agentAiDefaults: config.agentAiDefaults ?? {},
            // Legacy fields (downgrade compatibility)
            subagentAiDefaults: config.subagentAiDefaults ?? {},
          };
        }),
      updateAgentAiDefaults: t
        .input(schemas.config.updateAgentAiDefaults.input)
        .output(schemas.config.updateAgentAiDefaults.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            const normalized = normalizeAgentAiDefaults(input.agentAiDefaults);

            const legacySubagentDefaultsRaw: Record<string, unknown> = {};
            for (const [agentType, entry] of Object.entries(normalized)) {
              if (agentType === "plan" || agentType === "exec" || agentType === "compact") {
                continue;
              }
              legacySubagentDefaultsRaw[agentType] = entry;
            }

            const legacySubagentDefaults = normalizeSubagentAiDefaults(legacySubagentDefaultsRaw);

            return {
              ...config,
              agentAiDefaults: Object.keys(normalized).length > 0 ? normalized : undefined,
              // Legacy fields (downgrade compatibility)
              subagentAiDefaults:
                Object.keys(legacySubagentDefaults).length > 0 ? legacySubagentDefaults : undefined,
            };
          });
        }),
      saveConfig: t
        .input(schemas.config.saveConfig.input)
        .output(schemas.config.saveConfig.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            const normalizedTaskSettings = normalizeTaskSettings(input.taskSettings);
            const result = { ...config, taskSettings: normalizedTaskSettings };

            if (input.agentAiDefaults !== undefined) {
              const normalized = normalizeAgentAiDefaults(input.agentAiDefaults);
              result.agentAiDefaults = Object.keys(normalized).length > 0 ? normalized : undefined;

              if (input.subagentAiDefaults === undefined) {
                const legacySubagentDefaultsRaw: Record<string, unknown> = {};
                for (const [agentType, entry] of Object.entries(normalized)) {
                  if (agentType === "plan" || agentType === "exec" || agentType === "compact") {
                    continue;
                  }
                  legacySubagentDefaultsRaw[agentType] = entry;
                }

                const legacySubagentDefaults =
                  normalizeSubagentAiDefaults(legacySubagentDefaultsRaw);
                result.subagentAiDefaults =
                  Object.keys(legacySubagentDefaults).length > 0
                    ? legacySubagentDefaults
                    : undefined;
              }
            }

            if (input.subagentAiDefaults !== undefined) {
              const normalizedDefaults = normalizeSubagentAiDefaults(input.subagentAiDefaults);
              result.subagentAiDefaults =
                Object.keys(normalizedDefaults).length > 0 ? normalizedDefaults : undefined;

              // Downgrade compatibility: keep agentAiDefaults in sync with legacy subagentAiDefaults.
              // Only mutate keys previously managed by subagentAiDefaults so we don't clobber other
              // agent defaults (e.g., UI-selectable custom agents).
              const previousLegacy = config.subagentAiDefaults ?? {};
              const nextAgentAiDefaults: Record<string, unknown> = {
                ...(result.agentAiDefaults ?? config.agentAiDefaults ?? {}),
              };

              for (const legacyAgentType of Object.keys(previousLegacy)) {
                if (
                  legacyAgentType === "plan" ||
                  legacyAgentType === "exec" ||
                  legacyAgentType === "compact"
                ) {
                  continue;
                }
                if (!(legacyAgentType in normalizedDefaults)) {
                  delete nextAgentAiDefaults[legacyAgentType];
                }
              }

              for (const [agentType, entry] of Object.entries(normalizedDefaults)) {
                if (agentType === "plan" || agentType === "exec" || agentType === "compact")
                  continue;
                nextAgentAiDefaults[agentType] = entry;
              }

              const normalizedAgent = normalizeAgentAiDefaults(nextAgentAiDefaults);
              result.agentAiDefaults =
                Object.keys(normalizedAgent).length > 0 ? normalizedAgent : undefined;
            }

            return result;
          });

          // Re-evaluate task queue in case more slots opened up
          await context.taskService.maybeStartQueuedTasks();
        }),
    },
    uiLayouts: {
      getAll: t
        .input(schemas.uiLayouts.getAll.input)
        .output(schemas.uiLayouts.getAll.output)
        .handler(({ context }) => {
          const config = context.config.loadConfigOrDefault();
          return config.layoutPresets ?? DEFAULT_LAYOUT_PRESETS_CONFIG;
        }),
      saveAll: t
        .input(schemas.uiLayouts.saveAll.input)
        .output(schemas.uiLayouts.saveAll.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            const normalized = normalizeLayoutPresetsConfig(input.layoutPresets);
            return {
              ...config,
              layoutPresets: isLayoutPresetsConfigEmpty(normalized) ? undefined : normalized,
            };
          });
        }),
    },
    agents: {
      list: t
        .input(schemas.agents.list.input)
        .output(schemas.agents.list.output)
        .handler(async ({ context, input }) => {
          // Wait for workspace init before discovery (SSH may not be ready yet)
          if (input.workspaceId) {
            await context.aiService.waitForInit(input.workspaceId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          const descriptors = await discoverAgentDefinitions(runtime, discoveryPath);

          // Compute derived UI fields that depend on inheritance resolution.
          // This keeps frontend logic simple and ensures scope rules (same-name overrides)
          // are applied consistently.
          return Promise.all(
            descriptors.map(async (descriptor) => {
              try {
                const pkg = await readAgentDefinition(runtime, discoveryPath, descriptor.id);
                const chain = await resolveAgentInheritanceChain({
                  runtime,
                  workspacePath: discoveryPath,
                  agentId: descriptor.id,
                  agentDefinition: pkg,
                  workspaceId: input.workspaceId ?? "", // for logging only
                });

                const resolvedUiColor = chain.find((entry) => entry.uiColor)?.uiColor;

                return {
                  ...descriptor,
                  uiColor: descriptor.uiColor ?? resolvedUiColor,
                };
              } catch {
                return descriptor;
              }
            })
          );
        }),
      get: t
        .input(schemas.agents.get.input)
        .output(schemas.agents.get.output)
        .handler(async ({ context, input }) => {
          // Wait for workspace init before discovery (SSH may not be ready yet)
          if (input.workspaceId) {
            await context.aiService.waitForInit(input.workspaceId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          return readAgentDefinition(runtime, discoveryPath, input.agentId);
        }),
    },
    agentSkills: {
      list: t
        .input(schemas.agentSkills.list.input)
        .output(schemas.agentSkills.list.output)
        .handler(async ({ context, input }) => {
          // Wait for workspace init before agent discovery (SSH may not be ready yet)
          if (input.workspaceId) {
            await context.aiService.waitForInit(input.workspaceId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          return discoverAgentSkills(runtime, discoveryPath);
        }),
      get: t
        .input(schemas.agentSkills.get.input)
        .output(schemas.agentSkills.get.output)
        .handler(async ({ context, input }) => {
          // Wait for workspace init before agent discovery (SSH may not be ready yet)
          if (input.workspaceId) {
            await context.aiService.waitForInit(input.workspaceId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          const result = await readAgentSkill(runtime, discoveryPath, input.skillName);
          return result.package;
        }),
    },
    pluginPacks: {
      list: t
        .input(schemas.pluginPacks.list.input)
        .output(schemas.pluginPacks.list.output)
        .handler(({ context, input }) => {
          return context.pluginPackService.listPluginPacks(input.projectPath);
        }),
      setEnabled: t
        .input(schemas.pluginPacks.setEnabled.input)
        .output(schemas.pluginPacks.setEnabled.output)
        .handler(({ context, input }) => {
          context.pluginPackService.setPluginPackEnabled(
            input.name,
            input.enabled,
            input.projectPath
          );
        }),
      getMcpServers: t
        .input(schemas.pluginPacks.getMcpServers.input)
        .output(schemas.pluginPacks.getMcpServers.output)
        .handler(({ context, input }) => {
          return context.pluginPackService.getPluginMcpServers(input.name);
        }),
    },
    providers: {
      list: t
        .input(schemas.providers.list.input)
        .output(schemas.providers.list.output)
        .handler(({ context }) => context.providerService.list()),
      getConfig: t
        .input(schemas.providers.getConfig.input)
        .output(schemas.providers.getConfig.output)
        .handler(({ context }) => context.providerService.getConfig()),
      setProviderConfig: t
        .input(schemas.providers.setProviderConfig.input)
        .output(schemas.providers.setProviderConfig.output)
        .handler(({ context, input }) =>
          context.providerService.setConfig(input.provider, input.keyPath, input.value)
        ),
      setModels: t
        .input(schemas.providers.setModels.input)
        .output(schemas.providers.setModels.output)
        .handler(({ context, input }) =>
          context.providerService.setModels(input.provider, input.models)
        ),
      testConnection: t
        .input(schemas.providers.testConnection.input)
        .output(schemas.providers.testConnection.output)
        .handler(({ context, input }) =>
          context.providerService.testConnection(input.provider, input.model)
        ),
      onConfigChanged: t
        .input(schemas.providers.onConfigChanged.input)
        .output(schemas.providers.onConfigChanged.output)
        .handler(async function* ({ context }) {
          let resolveNext: (() => void) | null = null;
          let pendingNotification = false;
          let ended = false;

          const push = () => {
            if (ended) return;
            if (resolveNext) {
              // Listener is waiting - wake it up
              const resolve = resolveNext;
              resolveNext = null;
              resolve();
            } else {
              // No listener waiting yet - queue the notification
              pendingNotification = true;
            }
          };

          const unsubscribe = context.providerService.onConfigChanged(push);

          try {
            while (!ended) {
              // If notification arrived before we started waiting, yield immediately
              if (pendingNotification) {
                pendingNotification = false;
                yield undefined;
                continue;
              }
              // Wait for next notification
              await new Promise<void>((resolve) => {
                resolveNext = resolve;
              });
              yield undefined;
            }
          } finally {
            ended = true;
            unsubscribe();
          }
        }),
    },
    cliAgents: {
      detect: t
        .input(schemas.cliAgents.detect.input)
        .output(schemas.cliAgents.detect.output)
        .handler(async ({ context }) => context.cliAgentDetectionService.detectAll()),
      /**
       * Progressive detection stream.
       * Runs detectOne() for every agent in parallel and yields each result
       * the moment its probe finishes — installed agents arrive in ~100 ms,
       * uninstalled ones after their 5 s timeout. The stream ends once every
       * agent has been checked.
       */
      detectEach: t
        .input(schemas.cliAgents.detectEach.input)
        .output(schemas.cliAgents.detectEach.output)
        .handler(async function* ({ context }) {
          yield* context.cliAgentDetectionService.detectEach();
        }),
      detectOne: t
        .input(schemas.cliAgents.detectOne.input)
        .output(schemas.cliAgents.detectOne.output)
        .handler(async ({ context, input }) =>
          context.cliAgentDetectionService.detectOne(input.slug)
        ),
      install: t
        .input(schemas.cliAgents.install.input)
        .output(schemas.cliAgents.install.output)
        .handler(async ({ context, input }) =>
          context.cliAgentDetectionService.installAgent(input.slug)
        ),
      installStream: t
        .input(schemas.cliAgents.installStream.input)
        .output(schemas.cliAgents.installStream.output)
        .handler(async function* ({ context, input }) {
          yield* context.cliAgentDetectionService.installAgentStreaming(input.slug);
        }),
      run: t
        .input(schemas.cliAgents.run.input)
        .output(schemas.cliAgents.run.output)
        .handler(async ({ context, input }) => context.cliAgentOrchestrationService.run(input)),
      stop: t
        .input(schemas.cliAgents.stop.input)
        .output(schemas.cliAgents.stop.output)
        .handler(({ context, input }) => ({
          success: context.cliAgentOrchestrationService.stop(input.sessionId),
        })),
      listSessions: t
        .input(schemas.cliAgents.listSessions.input)
        .output(schemas.cliAgents.listSessions.output)
        .handler(({ context }) => context.cliAgentOrchestrationService.listSessions()),
      getPreferences: t
        .input(schemas.cliAgents.getPreferences.input)
        .output(schemas.cliAgents.getPreferences.output)
        .handler(({ context }) => context.cliAgentPreferencesService.getAll()),
      setPreferences: t
        .input(schemas.cliAgents.setPreferences.input)
        .output(schemas.cliAgents.setPreferences.output)
        .handler(({ context, input }) => {
          context.cliAgentPreferencesService.set(input.slug, input.preferences);
          return { success: true };
        }),
      checkHealth: t
        .input(schemas.cliAgents.checkHealth.input)
        .output(schemas.cliAgents.checkHealth.output)
        .handler(async ({ context, input }) =>
          context.cliAgentDetectionService.checkHealth(input.slug)
        ),
      checkAllHealth: t
        .input(schemas.cliAgents.checkAllHealth.input)
        .output(schemas.cliAgents.checkAllHealth.output)
        .handler(async ({ context }) =>
          context.cliAgentDetectionService.checkAllHealth()
        ),
    },
    general: {
      listDirectory: t
        .input(schemas.general.listDirectory.input)
        .output(schemas.general.listDirectory.output)
        .handler(async ({ context, input }) => {
          return context.projectService.listDirectory(input.path);
        }),
      createDirectory: t
        .input(schemas.general.createDirectory.input)
        .output(schemas.general.createDirectory.output)
        .handler(async ({ context, input }) => {
          return context.projectService.createDirectory(input.path);
        }),
      ping: t
        .input(schemas.general.ping.input)
        .output(schemas.general.ping.output)
        .handler(({ input }) => {
          return `Pong: ${input}`;
        }),
      tick: t
        .input(schemas.general.tick.input)
        .output(schemas.general.tick.output)
        .handler(async function* ({ input }) {
          for (let i = 1; i <= input.count; i++) {
            yield { tick: i, timestamp: Date.now() };
            if (i < input.count) {
              await new Promise((r) => setTimeout(r, input.intervalMs));
            }
          }
        }),
      openInEditor: t
        .input(schemas.general.openInEditor.input)
        .output(schemas.general.openInEditor.output)
        .handler(async ({ context, input }) => {
          return context.editorService.openInEditor(
            input.workspaceId,
            input.targetPath,
            input.editorConfig
          );
        }),
    },
    projects: {
      list: t
        .input(schemas.projects.list.input)
        .output(schemas.projects.list.output)
        .handler(({ context }) => {
          return context.projectService.list();
        }),
      create: t
        .input(schemas.projects.create.input)
        .output(schemas.projects.create.output)
        .handler(async ({ context, input }) => {
          return context.projectService.create(input.projectPath);
        }),
      pickDirectory: t
        .input(schemas.projects.pickDirectory.input)
        .output(schemas.projects.pickDirectory.output)
        .handler(async ({ context }) => {
          return context.projectService.pickDirectory();
        }),
      getFileCompletions: t
        .input(schemas.projects.getFileCompletions.input)
        .output(schemas.projects.getFileCompletions.output)
        .handler(async ({ context, input }) => {
          return context.projectService.getFileCompletions(
            input.projectPath,
            input.query,
            input.limit
          );
        }),
      runtimeAvailability: t
        .input(schemas.projects.runtimeAvailability.input)
        .output(schemas.projects.runtimeAvailability.output)
        .handler(async ({ input }) => {
          return checkRuntimeAvailability(input.projectPath);
        }),
      listBranches: t
        .input(schemas.projects.listBranches.input)
        .output(schemas.projects.listBranches.output)
        .handler(async ({ context, input }) => {
          return context.projectService.listBranches(input.projectPath);
        }),
      gitInit: t
        .input(schemas.projects.gitInit.input)
        .output(schemas.projects.gitInit.output)
        .handler(async ({ context, input }) => {
          return context.projectService.gitInit(input.projectPath);
        }),
      remove: t
        .input(schemas.projects.remove.input)
        .output(schemas.projects.remove.output)
        .handler(async ({ context, input }) => {
          return context.projectService.remove(input.projectPath, input.force);
        }),
      secrets: {
        get: t
          .input(schemas.projects.secrets.get.input)
          .output(schemas.projects.secrets.get.output)
          .handler(({ context, input }) => {
            return context.projectService.getSecrets(input.projectPath);
          }),
        update: t
          .input(schemas.projects.secrets.update.input)
          .output(schemas.projects.secrets.update.output)
          .handler(async ({ context, input }) => {
            return context.projectService.updateSecrets(input.projectPath, input.secrets);
          }),
      },
      mcp: {
        list: t
          .input(schemas.projects.mcp.list.input)
          .output(schemas.projects.mcp.list.output)
          .handler(({ context, input }) =>
            context.mcpServerManager.getAllServers(input.projectPath)
          ),
        add: t
          .input(schemas.projects.mcp.add.input)
          .output(schemas.projects.mcp.add.output)
          .handler(async ({ context, input }) => {
            const existing = await context.mcpConfigService.listServers(input.projectPath);
            const existingServer = existing[input.name];

            const transport = input.transport ?? "stdio";
            const hasHeaders = Boolean(input.headers && Object.keys(input.headers).length > 0);
            const usesSecretHeaders = Boolean(
              input.headers &&
              Object.values(input.headers).some(
                (v) => typeof v === "object" && v !== null && "secret" in v
              )
            );

            const action = (() => {
              if (!existingServer) {
                return "add";
              }

              if (
                existingServer.transport !== "stdio" &&
                transport !== "stdio" &&
                existingServer.transport === transport &&
                existingServer.url === input.url &&
                JSON.stringify(existingServer.headers ?? {}) !== JSON.stringify(input.headers ?? {})
              ) {
                return "set_headers";
              }

              return "edit";
            })();

            const result = await context.mcpConfigService.addServer(input.projectPath, input.name, {
              transport,
              command: input.command,
              url: input.url,
              headers: input.headers,
            });

            if (result.success) {
              context.telemetryService.capture({
                event: "mcp_server_config_changed",
                properties: {
                  action,
                  transport,
                  has_headers: hasHeaders,
                  uses_secret_headers: usesSecretHeaders,
                },
              });
            }

            return result;
          }),
        remove: t
          .input(schemas.projects.mcp.remove.input)
          .output(schemas.projects.mcp.remove.output)
          .handler(async ({ context, input }) => {
            const existing = await context.mcpServerManager.getAllServers(input.projectPath);
            const server = existing[input.name];

            const result = await context.mcpConfigService.removeServer(
              input.projectPath,
              input.name
            );

            if (result.success && server) {
              const hasHeaders =
                server.transport !== "stdio" &&
                Boolean(server.headers && Object.keys(server.headers).length > 0);
              const usesSecretHeaders =
                server.transport !== "stdio" &&
                Boolean(
                  server.headers &&
                  Object.values(server.headers).some(
                    (v) => typeof v === "object" && v !== null && "secret" in v
                  )
                );

              context.telemetryService.capture({
                event: "mcp_server_config_changed",
                properties: {
                  action: "remove",
                  transport: server.transport,
                  has_headers: hasHeaders,
                  uses_secret_headers: usesSecretHeaders,
                },
              });
            }

            return result;
          }),
        test: t
          .input(schemas.projects.mcp.test.input)
          .output(schemas.projects.mcp.test.output)
          .handler(async ({ context, input }) => {
            const start = Date.now();
            const secrets = secretsToRecord(context.projectService.getSecrets(input.projectPath));

            const configuredTransport = input.name
              ? (await context.mcpServerManager.getAllServers(input.projectPath))[input.name]
                  ?.transport
              : undefined;

            const transport =
              configuredTransport ?? (input.command ? "stdio" : (input.transport ?? "auto"));

            const result = await context.mcpServerManager.test({
              projectPath: input.projectPath,
              name: input.name,
              command: input.command,
              transport: input.transport,
              url: input.url,
              headers: input.headers,
              projectSecrets: secrets,
            });

            const durationMs = Date.now() - start;

            const categorizeError = (
              error: string
            ): "timeout" | "connect" | "http_status" | "unknown" => {
              const lower = error.toLowerCase();
              if (lower.includes("timed out")) {
                return "timeout";
              }
              if (
                lower.includes("econnrefused") ||
                lower.includes("econnreset") ||
                lower.includes("enotfound") ||
                lower.includes("ehostunreach")
              ) {
                return "connect";
              }
              if (/\b(400|401|403|404|405|500|502|503)\b/.test(lower)) {
                return "http_status";
              }
              return "unknown";
            };

            context.telemetryService.capture({
              event: "mcp_server_tested",
              properties: {
                transport,
                success: result.success,
                duration_ms_b2: roundToBase2(durationMs),
                ...(result.success ? {} : { error_category: categorizeError(result.error) }),
              },
            });

            return result;
          }),
        setEnabled: t
          .input(schemas.projects.mcp.setEnabled.input)
          .output(schemas.projects.mcp.setEnabled.output)
          .handler(async ({ context, input }) => {
            const existing = await context.mcpServerManager.getAllServers(input.projectPath);
            const server = existing[input.name];

            const result = await context.mcpConfigService.setServerEnabled(
              input.projectPath,
              input.name,
              input.enabled
            );

            if (result.success && server) {
              const hasHeaders =
                server.transport !== "stdio" &&
                Boolean(server.headers && Object.keys(server.headers).length > 0);
              const usesSecretHeaders =
                server.transport !== "stdio" &&
                Boolean(
                  server.headers &&
                  Object.values(server.headers).some(
                    (v) => typeof v === "object" && v !== null && "secret" in v
                  )
                );

              context.telemetryService.capture({
                event: "mcp_server_config_changed",
                properties: {
                  action: input.enabled ? "enable" : "disable",
                  transport: server.transport,
                  has_headers: hasHeaders,
                  uses_secret_headers: usesSecretHeaders,
                },
              });
            }

            return result;
          }),
        setToolAllowlist: t
          .input(schemas.projects.mcp.setToolAllowlist.input)
          .output(schemas.projects.mcp.setToolAllowlist.output)
          .handler(async ({ context, input }) => {
            const existing = await context.mcpServerManager.getAllServers(input.projectPath);
            const server = existing[input.name];

            const result = await context.mcpConfigService.setToolAllowlist(
              input.projectPath,
              input.name,
              input.toolAllowlist
            );

            if (result.success && server) {
              const hasHeaders =
                server.transport !== "stdio" &&
                Boolean(server.headers && Object.keys(server.headers).length > 0);
              const usesSecretHeaders =
                server.transport !== "stdio" &&
                Boolean(
                  server.headers &&
                  Object.values(server.headers).some(
                    (v) => typeof v === "object" && v !== null && "secret" in v
                  )
                );

              context.telemetryService.capture({
                event: "mcp_server_config_changed",
                properties: {
                  action: "set_tool_allowlist",
                  transport: server.transport,
                  has_headers: hasHeaders,
                  uses_secret_headers: usesSecretHeaders,
                  tool_allowlist_size_b2: roundToBase2(input.toolAllowlist.length),
                },
              });
            }

            return result;
          }),
      },
      idleCompaction: {
        get: t
          .input(schemas.projects.idleCompaction.get.input)
          .output(schemas.projects.idleCompaction.get.output)
          .handler(({ context, input }) => ({
            hours: context.projectService.getIdleCompactionHours(input.projectPath),
          })),
        set: t
          .input(schemas.projects.idleCompaction.set.input)
          .output(schemas.projects.idleCompaction.set.output)
          .handler(({ context, input }) =>
            context.projectService.setIdleCompactionHours(input.projectPath, input.hours)
          ),
      },
      sections: {
        list: t
          .input(schemas.projects.sections.list.input)
          .output(schemas.projects.sections.list.output)
          .handler(({ context, input }) => context.projectService.listSections(input.projectPath)),
        create: t
          .input(schemas.projects.sections.create.input)
          .output(schemas.projects.sections.create.output)
          .handler(({ context, input }) =>
            context.projectService.createSection(input.projectPath, input.name, input.color)
          ),
        update: t
          .input(schemas.projects.sections.update.input)
          .output(schemas.projects.sections.update.output)
          .handler(({ context, input }) =>
            context.projectService.updateSection(input.projectPath, input.sectionId, {
              name: input.name,
              color: input.color,
            })
          ),
        remove: t
          .input(schemas.projects.sections.remove.input)
          .output(schemas.projects.sections.remove.output)
          .handler(({ context, input }) =>
            context.projectService.removeSection(input.projectPath, input.sectionId)
          ),
        reorder: t
          .input(schemas.projects.sections.reorder.input)
          .output(schemas.projects.sections.reorder.output)
          .handler(({ context, input }) =>
            context.projectService.reorderSections(input.projectPath, input.sectionIds)
          ),
        assignWorkspace: t
          .input(schemas.projects.sections.assignWorkspace.input)
          .output(schemas.projects.sections.assignWorkspace.output)
          .handler(async ({ context, input }) => {
            const result = await context.projectService.assignWorkspaceToSection(
              input.projectPath,
              input.workspaceId,
              input.sectionId
            );
            if (result.success) {
              // Emit metadata update so frontend receives the sectionId change
              await context.workspaceService.refreshAndEmitMetadata(input.workspaceId);
            }
            return result;
          }),
      },
    },
    nameGeneration: {
      generate: t
        .input(schemas.nameGeneration.generate.input)
        .output(schemas.nameGeneration.generate.output)
        .handler(async ({ context, input }) => {
          // Select model with intelligent fallback:
          // 1. Try preferred models (Haiku, GPT-Mini) or caller-specified models
          // 2. Try OpenRouter variants of preferred models
          // 3. Fallback to any available known model
          const model = await selectModelForNameGeneration(
            context.aiService,
            input.preferredModels,
            input.userModel
          );
          if (!model) {
            return {
              success: false,
              error: {
                type: "unknown" as const,
                raw: "No model available for name generation.",
              },
            };
          }
          const result = await generateWorkspaceIdentity(input.message, model, context.aiService);
          if (!result.success) {
            return result;
          }
          return {
            success: true,
            data: { name: result.data.name, title: result.data.title, modelUsed: model },
          };
        }),
    },
    lattice: {
      getInfo: t
        .input(schemas.lattice.getInfo.input)
        .output(schemas.lattice.getInfo.output)
        .handler(async ({ context }) => {
          return context.latticeService.getLatticeInfo();
        }),
      listTemplates: t
        .input(schemas.lattice.listTemplates.input)
        .output(schemas.lattice.listTemplates.output)
        .handler(async ({ context }) => {
          return context.latticeService.listTemplates();
        }),
      listPresets: t
        .input(schemas.lattice.listPresets.input)
        .output(schemas.lattice.listPresets.output)
        .handler(async ({ context, input }) => {
          return context.latticeService.listPresets(input.template, input.org);
        }),
      listWorkspaces: t
        .input(schemas.lattice.listWorkspaces.input)
        .output(schemas.lattice.listWorkspaces.output)
        .handler(async ({ context }) => {
          return context.latticeService.listWorkspaces();
        }),
      whoami: t
        .input(schemas.lattice.whoami.input)
        .output(schemas.lattice.whoami.output)
        .handler(async ({ context, input }) => {
          if (input?.refresh) {
            context.latticeService.clearWhoamiCache();
          }
          return context.latticeService.getWhoamiInfo();
        }),
      login: t
        .input(schemas.lattice.login.input)
        .output(schemas.lattice.login.output)
        .handler(async ({ context, input }) => {
          return context.latticeService.login(input.url, input.sessionToken);
        }),
    },
    workspace: {
      list: t
        .input(schemas.workspace.list.input)
        .output(schemas.workspace.list.output)
        .handler(async ({ context, input }) => {
          const allWorkspaces = await context.workspaceService.list();
          // Filter by archived status (derived from timestamps via shared utility)
          if (input?.archived) {
            return allWorkspaces.filter((w) => isWorkspaceArchived(w.archivedAt, w.unarchivedAt));
          }
          // Default: return non-archived workspaces
          return allWorkspaces.filter((w) => !isWorkspaceArchived(w.archivedAt, w.unarchivedAt));
        }),
      create: t
        .input(schemas.workspace.create.input)
        .output(schemas.workspace.create.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.create(
            input.projectPath,
            input.branchName,
            input.trunkBranch,
            input.title,
            input.runtimeConfig,
            input.sectionId
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, metadata: result.data.metadata };
        }),
      remove: t
        .input(schemas.workspace.remove.input)
        .output(schemas.workspace.remove.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.remove(
            input.workspaceId,
            input.options?.force
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true };
        }),
      updateAgentAISettings: t
        .input(schemas.workspace.updateAgentAISettings.input)
        .output(schemas.workspace.updateAgentAISettings.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.updateAgentAISettings(
            input.workspaceId,
            input.agentId,
            input.aiSettings
          );
        }),
      rename: t
        .input(schemas.workspace.rename.input)
        .output(schemas.workspace.rename.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.rename(input.workspaceId, input.newName);
        }),
      updateModeAISettings: t
        .input(schemas.workspace.updateModeAISettings.input)
        .output(schemas.workspace.updateModeAISettings.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.updateModeAISettings(
            input.workspaceId,
            input.mode,
            input.aiSettings
          );
        }),
      updateTitle: t
        .input(schemas.workspace.updateTitle.input)
        .output(schemas.workspace.updateTitle.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.updateTitle(input.workspaceId, input.title);
        }),
      archive: t
        .input(schemas.workspace.archive.input)
        .output(schemas.workspace.archive.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.archive(input.workspaceId);
        }),
      unarchive: t
        .input(schemas.workspace.unarchive.input)
        .output(schemas.workspace.unarchive.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.unarchive(input.workspaceId);
        }),
      fork: t
        .input(schemas.workspace.fork.input)
        .output(schemas.workspace.fork.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.fork(
            input.sourceWorkspaceId,
            input.newName
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return {
            success: true,
            metadata: result.data.metadata,
            projectPath: result.data.projectPath,
          };
        }),
      sendMessage: t
        .input(schemas.workspace.sendMessage.input)
        .output(schemas.workspace.sendMessage.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.sendMessage(
            input.workspaceId,
            input.message,
            input.options
          );

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return { success: true, data: {} };
        }),
      answerAskUserQuestion: t
        .input(schemas.workspace.answerAskUserQuestion.input)
        .output(schemas.workspace.answerAskUserQuestion.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.answerAskUserQuestion(
            input.workspaceId,
            input.toolCallId,
            input.answers
          );

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return { success: true, data: undefined };
        }),
      resumeStream: t
        .input(schemas.workspace.resumeStream.input)
        .output(schemas.workspace.resumeStream.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.resumeStream(
            input.workspaceId,
            input.options
          );
          if (!result.success) {
            const error =
              typeof result.error === "string"
                ? { type: "unknown" as const, raw: result.error }
                : result.error;
            return { success: false, error };
          }
          return { success: true, data: undefined };
        }),
      interruptStream: t
        .input(schemas.workspace.interruptStream.input)
        .output(schemas.workspace.interruptStream.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.interruptStream(
            input.workspaceId,
            input.options
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      clearQueue: t
        .input(schemas.workspace.clearQueue.input)
        .output(schemas.workspace.clearQueue.output)
        .handler(({ context, input }) => {
          const result = context.workspaceService.clearQueue(input.workspaceId);
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      truncateHistory: t
        .input(schemas.workspace.truncateHistory.input)
        .output(schemas.workspace.truncateHistory.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.truncateHistory(
            input.workspaceId,
            input.percentage
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      replaceChatHistory: t
        .input(schemas.workspace.replaceChatHistory.input)
        .output(schemas.workspace.replaceChatHistory.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.replaceHistory(
            input.workspaceId,
            input.summaryMessage,
            { deletePlanFile: input.deletePlanFile }
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      getDevcontainerInfo: t
        .input(schemas.workspace.getDevcontainerInfo.input)
        .output(schemas.workspace.getDevcontainerInfo.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.getDevcontainerInfo(input.workspaceId);
        }),
      getInfo: t
        .input(schemas.workspace.getInfo.input)
        .output(schemas.workspace.getInfo.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.getInfo(input.workspaceId);
        }),
      getLastLlmRequest: t
        .input(schemas.workspace.getLastLlmRequest.input)
        .output(schemas.workspace.getLastLlmRequest.output)
        .handler(({ context, input }) => {
          return context.aiService.debugGetLastLlmRequest(input.workspaceId);
        }),
      getFullReplay: t
        .input(schemas.workspace.getFullReplay.input)
        .output(schemas.workspace.getFullReplay.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.getFullReplay(input.workspaceId);
        }),
      executeBash: t
        .input(schemas.workspace.executeBash.input)
        .output(schemas.workspace.executeBash.output)
        .handler(async ({ context, input }) => {
          const result = await context.workspaceService.executeBash(
            input.workspaceId,
            input.script,
            input.options
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        }),
      getFileCompletions: t
        .input(schemas.workspace.getFileCompletions.input)
        .output(schemas.workspace.getFileCompletions.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.getFileCompletions(
            input.workspaceId,
            input.query,
            input.limit
          );
        }),
      onChat: t
        .input(schemas.workspace.onChat.input)
        .output(schemas.workspace.onChat.output)
        .handler(async function* ({ context, input }) {
          const session = context.workspaceService.getOrCreateSession(input.workspaceId);
          const { push, iterate, end } = createAsyncMessageQueue<WorkspaceChatMessage>();

          // 1. Subscribe to new events (including those triggered by replay)
          const unsubscribe = session.onChatEvent(({ message }) => {
            push(message);
          });

          // 2. Replay history (sends caught-up at the end)
          await session.replayHistory(({ message }) => {
            push(message);
          });

          // 3. Heartbeat to keep the connection alive during long operations (tool calls, subagents).
          // Client uses this to detect stalled connections vs. intentionally idle streams.
          const HEARTBEAT_INTERVAL_MS = 5_000;
          const heartbeatInterval = setInterval(() => {
            push({ type: "heartbeat" });
          }, HEARTBEAT_INTERVAL_MS);

          try {
            yield* iterate();
          } finally {
            clearInterval(heartbeatInterval);
            end();
            unsubscribe();
          }
        }),
      onMetadata: t
        .input(schemas.workspace.onMetadata.input)
        .output(schemas.workspace.onMetadata.output)
        .handler(async function* ({ context }) {
          const service = context.workspaceService;

          let resolveNext:
            | ((value: {
                workspaceId: string;
                metadata: FrontendWorkspaceMetadataSchemaType | null;
              }) => void)
            | null = null;
          const queue: Array<{
            workspaceId: string;
            metadata: FrontendWorkspaceMetadataSchemaType | null;
          }> = [];
          let ended = false;

          const push = (event: {
            workspaceId: string;
            metadata: FrontendWorkspaceMetadataSchemaType | null;
          }) => {
            if (ended) return;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(event);
            } else {
              queue.push(event);
            }
          };

          const onMetadata = (event: {
            workspaceId: string;
            metadata: FrontendWorkspaceMetadataSchemaType | null;
          }) => {
            push(event);
          };

          service.on("metadata", onMetadata);

          try {
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
              } else {
                const event = await new Promise<{
                  workspaceId: string;
                  metadata: FrontendWorkspaceMetadataSchemaType | null;
                }>((resolve) => {
                  resolveNext = resolve;
                });
                yield event;
              }
            }
          } finally {
            ended = true;
            service.off("metadata", onMetadata);
          }
        }),
      activity: {
        list: t
          .input(schemas.workspace.activity.list.input)
          .output(schemas.workspace.activity.list.output)
          .handler(async ({ context }) => {
            return context.workspaceService.getActivityList();
          }),
        subscribe: t
          .input(schemas.workspace.activity.subscribe.input)
          .output(schemas.workspace.activity.subscribe.output)
          .handler(async function* ({ context }) {
            const service = context.workspaceService;

            let resolveNext:
              | ((value: {
                  workspaceId: string;
                  activity: WorkspaceActivitySnapshot | null;
                }) => void)
              | null = null;
            const queue: Array<{
              workspaceId: string;
              activity: WorkspaceActivitySnapshot | null;
            }> = [];
            let ended = false;

            const push = (event: {
              workspaceId: string;
              activity: WorkspaceActivitySnapshot | null;
            }) => {
              if (ended) return;
              if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                resolve(event);
              } else {
                queue.push(event);
              }
            };

            const onActivity = (event: {
              workspaceId: string;
              activity: WorkspaceActivitySnapshot | null;
            }) => {
              push(event);
            };

            service.on("activity", onActivity);

            try {
              while (!ended) {
                if (queue.length > 0) {
                  yield queue.shift()!;
                } else {
                  const event = await new Promise<{
                    workspaceId: string;
                    activity: WorkspaceActivitySnapshot | null;
                  }>((resolve) => {
                    resolveNext = resolve;
                  });
                  yield event;
                }
              }
            } finally {
              ended = true;
              service.off("activity", onActivity);
            }
          }),
      },
      getPlanContent: t
        .input(schemas.workspace.getPlanContent.input)
        .output(schemas.workspace.getPlanContent.output)
        .handler(async ({ context, input }) => {
          // Get workspace metadata to determine runtime and paths
          const metadata = await context.workspaceService.getInfo(input.workspaceId);
          if (!metadata) {
            return { success: false as const, error: `Workspace not found: ${input.workspaceId}` };
          }

          // Create runtime to read plan file (supports both local and SSH)
          const runtime = createRuntimeForWorkspace(metadata);

          const result = await readPlanFile(
            runtime,
            metadata.name,
            metadata.projectName,
            input.workspaceId
          );

          if (!result.exists) {
            return { success: false as const, error: `Plan file not found at ${result.path}` };
          }
          return { success: true as const, data: { content: result.content, path: result.path } };
        }),
      backgroundBashes: {
        subscribe: t
          .input(schemas.workspace.backgroundBashes.subscribe.input)
          .output(schemas.workspace.backgroundBashes.subscribe.output)
          .handler(async function* ({ context, input }) {
            const service = context.workspaceService;
            const { workspaceId } = input;

            const getState = async () => ({
              processes: await service.listBackgroundProcesses(workspaceId),
              foregroundToolCallIds: service.getForegroundToolCallIds(workspaceId),
            });

            const queue = createAsyncEventQueue<Awaited<ReturnType<typeof getState>>>();

            const onChange = (changedWorkspaceId: string) => {
              if (changedWorkspaceId === workspaceId) {
                void getState().then(queue.push);
              }
            };

            service.onBackgroundBashChange(onChange);

            try {
              // Emit initial state immediately
              yield await getState();
              yield* queue.iterate();
            } finally {
              queue.end();
              service.offBackgroundBashChange(onChange);
            }
          }),
        terminate: t
          .input(schemas.workspace.backgroundBashes.terminate.input)
          .output(schemas.workspace.backgroundBashes.terminate.output)
          .handler(async ({ context, input }) => {
            const result = await context.workspaceService.terminateBackgroundProcess(
              input.workspaceId,
              input.processId
            );
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return { success: true, data: undefined };
          }),
        sendToBackground: t
          .input(schemas.workspace.backgroundBashes.sendToBackground.input)
          .output(schemas.workspace.backgroundBashes.sendToBackground.output)
          .handler(({ context, input }) => {
            const result = context.workspaceService.sendToBackground(input.toolCallId);
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return { success: true, data: undefined };
          }),
        getOutput: t
          .input(schemas.workspace.backgroundBashes.getOutput.input)
          .output(schemas.workspace.backgroundBashes.getOutput.output)
          .handler(async ({ context, input }) => {
            const result = await context.workspaceService.getBackgroundProcessOutput(
              input.workspaceId,
              input.processId,
              { fromOffset: input.fromOffset, tailBytes: input.tailBytes }
            );
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return { success: true, data: result.data };
          }),
      },
      getPostCompactionState: t
        .input(schemas.workspace.getPostCompactionState.input)
        .output(schemas.workspace.getPostCompactionState.output)
        .handler(({ context, input }) => {
          return context.workspaceService.getPostCompactionState(input.workspaceId);
        }),
      setPostCompactionExclusion: t
        .input(schemas.workspace.setPostCompactionExclusion.input)
        .output(schemas.workspace.setPostCompactionExclusion.output)
        .handler(async ({ context, input }) => {
          return context.workspaceService.setPostCompactionExclusion(
            input.workspaceId,
            input.itemId,
            input.excluded
          );
        }),
      getSessionUsage: t
        .input(schemas.workspace.getSessionUsage.input)
        .output(schemas.workspace.getSessionUsage.output)
        .handler(async ({ context, input }) => {
          return context.sessionUsageService.getSessionUsage(input.workspaceId);
        }),
      getSessionUsageBatch: t
        .input(schemas.workspace.getSessionUsageBatch.input)
        .output(schemas.workspace.getSessionUsageBatch.output)
        .handler(async ({ context, input }) => {
          return context.sessionUsageService.getSessionUsageBatch(input.workspaceIds);
        }),
      stats: {
        subscribe: t
          .input(schemas.workspace.stats.subscribe.input)
          .output(schemas.workspace.stats.subscribe.output)
          .handler(async function* ({ context, input }) {
            const workspaceId = input.workspaceId;

            context.sessionTimingService.addSubscriber(workspaceId);

            const queue = createAsyncEventQueue<WorkspaceStatsSnapshot>();
            let pending = Promise.resolve();

            const enqueueSnapshot = () => {
              pending = pending.then(async () => {
                queue.push(await context.sessionTimingService.getSnapshot(workspaceId));
              });
            };

            const onChange = (changedWorkspaceId: string) => {
              if (changedWorkspaceId !== workspaceId) {
                return;
              }
              enqueueSnapshot();
            };

            context.sessionTimingService.onStatsChange(onChange);

            try {
              queue.push(await context.sessionTimingService.getSnapshot(workspaceId));
              yield* queue.iterate();
            } finally {
              queue.end();
              context.sessionTimingService.offStatsChange(onChange);
              context.sessionTimingService.removeSubscriber(workspaceId);
            }
          }),
        clear: t
          .input(schemas.workspace.stats.clear.input)
          .output(schemas.workspace.stats.clear.output)
          .handler(async ({ context, input }) => {
            try {
              await context.sessionTimingService.clearTimingFile(input.workspaceId);
              return { success: true, data: undefined };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return { success: false, error: message };
            }
          }),
      },
      mcp: {
        get: t
          .input(schemas.workspace.mcp.get.input)
          .output(schemas.workspace.mcp.get.output)
          .handler(async ({ context, input }) => {
            try {
              return await context.workspaceMcpOverridesService.getOverridesForWorkspace(
                input.workspaceId
              );
            } catch {
              // Defensive: overrides must never brick workspace UI.
              return {};
            }
          }),
        set: t
          .input(schemas.workspace.mcp.set.input)
          .output(schemas.workspace.mcp.set.output)
          .handler(async ({ context, input }) => {
            try {
              await context.workspaceMcpOverridesService.setOverridesForWorkspace(
                input.workspaceId,
                input.overrides
              );
              return { success: true, data: undefined };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return { success: false, error: message };
            }
          }),
      },
    },
    tasks: {
      create: t
        .input(schemas.tasks.create.input)
        .output(schemas.tasks.create.output)
        .handler(({ context, input }) => {
          const thinkingLevel =
            input.thinkingLevel === "off" ||
            input.thinkingLevel === "low" ||
            input.thinkingLevel === "medium" ||
            input.thinkingLevel === "high" ||
            input.thinkingLevel === "xhigh"
              ? input.thinkingLevel
              : undefined;

          return context.taskService.create({
            parentWorkspaceId: input.parentWorkspaceId,
            kind: input.kind,
            agentId: input.agentId,
            agentType: input.agentType,
            prompt: input.prompt,
            title: input.title,
            modelString: input.modelString,
            thinkingLevel,
          });
        }),
    },
    window: {
      setTitle: t
        .input(schemas.window.setTitle.input)
        .output(schemas.window.setTitle.output)
        .handler(({ context, input }) => {
          return context.windowService.setTitle(input.title);
        }),
    },
    terminal: {
      create: t
        .input(schemas.terminal.create.input)
        .output(schemas.terminal.create.output)
        .handler(async ({ context, input }) => {
          return context.terminalService.create(input);
        }),
      close: t
        .input(schemas.terminal.close.input)
        .output(schemas.terminal.close.output)
        .handler(({ context, input }) => {
          return context.terminalService.close(input.sessionId);
        }),
      resize: t
        .input(schemas.terminal.resize.input)
        .output(schemas.terminal.resize.output)
        .handler(({ context, input }) => {
          return context.terminalService.resize(input);
        }),
      sendInput: t
        .input(schemas.terminal.sendInput.input)
        .output(schemas.terminal.sendInput.output)
        .handler(({ context, input }) => {
          context.terminalService.sendInput(input.sessionId, input.data);
        }),
      onOutput: t
        .input(schemas.terminal.onOutput.input)
        .output(schemas.terminal.onOutput.output)
        .handler(async function* ({ context, input }) {
          let resolveNext: ((value: string) => void) | null = null;
          const queue: string[] = [];
          let ended = false;

          const push = (data: string) => {
            if (ended) return;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(data);
            } else {
              queue.push(data);
            }
          };

          const unsubscribe = context.terminalService.onOutput(input.sessionId, push);

          try {
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
              } else {
                const data = await new Promise<string>((resolve) => {
                  resolveNext = resolve;
                });
                yield data;
              }
            }
          } finally {
            ended = true;
            unsubscribe();
          }
        }),
      attach: t
        .input(schemas.terminal.attach.input)
        .output(schemas.terminal.attach.output)
        .handler(async function* ({ context, input }) {
          type AttachMessage =
            | { type: "screenState"; data: string }
            | { type: "output"; data: string };

          let resolveNext: ((value: AttachMessage) => void) | null = null;
          const queue: AttachMessage[] = [];
          let ended = false;

          const push = (msg: AttachMessage) => {
            if (ended) return;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(msg);
            } else {
              queue.push(msg);
            }
          };

          // CRITICAL: Subscribe to output FIRST, BEFORE capturing screen state.
          // This ensures any output that arrives during/after getScreenState() is queued.
          const unsubscribe = context.terminalService.onOutput(input.sessionId, (data) => {
            push({ type: "output", data });
          });

          try {
            // Capture screen state AFTER subscription is set up - guarantees no missed output
            const screenState = context.terminalService.getScreenState(input.sessionId);

            // First message is always the screen state (may be empty for new sessions)
            yield { type: "screenState" as const, data: screenState };

            // Now yield any queued output and continue with live stream
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
              } else {
                const msg = await new Promise<AttachMessage>((resolve) => {
                  resolveNext = resolve;
                });
                yield msg;
              }
            }
          } finally {
            ended = true;
            unsubscribe();
          }
        }),
      onExit: t
        .input(schemas.terminal.onExit.input)
        .output(schemas.terminal.onExit.output)
        .handler(async function* ({ context, input }) {
          let resolveNext: ((value: number) => void) | null = null;
          const queue: number[] = [];
          let ended = false;

          const push = (code: number) => {
            if (ended) return;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(code);
            } else {
              queue.push(code);
            }
          };

          const unsubscribe = context.terminalService.onExit(input.sessionId, push);

          try {
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
                // Terminal only exits once, so we can finish the stream
                break;
              } else {
                const code = await new Promise<number>((resolve) => {
                  resolveNext = resolve;
                });
                yield code;
                break;
              }
            }
          } finally {
            ended = true;
            unsubscribe();
          }
        }),
      openWindow: t
        .input(schemas.terminal.openWindow.input)
        .output(schemas.terminal.openWindow.output)
        .handler(async ({ context, input }) => {
          return context.terminalService.openWindow(input.workspaceId, input.sessionId);
        }),
      closeWindow: t
        .input(schemas.terminal.closeWindow.input)
        .output(schemas.terminal.closeWindow.output)
        .handler(({ context, input }) => {
          return context.terminalService.closeWindow(input.workspaceId);
        }),
      listSessions: t
        .input(schemas.terminal.listSessions.input)
        .output(schemas.terminal.listSessions.output)
        .handler(({ context, input }) => {
          return context.terminalService.getWorkspaceSessionIds(input.workspaceId);
        }),
      openNative: t
        .input(schemas.terminal.openNative.input)
        .output(schemas.terminal.openNative.output)
        .handler(async ({ context, input }) => {
          return context.terminalService.openNative(input.workspaceId);
        }),

      /**
       * Subscribe to AI-hired employee terminal sessions for a workspace.
       * Emits whenever PM Chat's hire_employee tool creates a new session.
       */
      onEmployeeHired: t
        .input(schemas.terminal.onEmployeeHired.input)
        .output(schemas.terminal.onEmployeeHired.output)
        .handler(async function* ({ context, input }) {
          const emitter = context.terminalService.getOrCreateSessionCreatedEmitter(
            input.workspaceId
          );
          yield* asyncEventIterator<{ sessionId: string; slug: string; label: string }>(
            (handler) => emitter.on("session", handler),
            (handler) => emitter.off("session", handler)
          );
        }),

      scrollback: {
        load: t
          .input(schemas.terminal.scrollback.load.input)
          .output(schemas.terminal.scrollback.load.output)
          .handler(async ({ context, input }) => {
            return context.terminalScrollbackService.load(input.sessionId);
          }),
        append: t
          .input(schemas.terminal.scrollback.append.input)
          .output(schemas.terminal.scrollback.append.output)
          .handler(async ({ context, input }) => {
            await context.terminalScrollbackService.append(input.sessionId, input.data);
          }),
        clear: t
          .input(schemas.terminal.scrollback.clear.input)
          .output(schemas.terminal.scrollback.clear.output)
          .handler(async ({ context, input }) => {
            await context.terminalScrollbackService.clear(input.sessionId);
          }),
      },
    },
    update: {
      check: t
        .input(schemas.update.check.input)
        .output(schemas.update.check.output)
        .handler(async ({ context }) => {
          return context.updateService.check();
        }),
      download: t
        .input(schemas.update.download.input)
        .output(schemas.update.download.output)
        .handler(async ({ context }) => {
          return context.updateService.download();
        }),
      install: t
        .input(schemas.update.install.input)
        .output(schemas.update.install.output)
        .handler(({ context }) => {
          return context.updateService.install();
        }),
      onStatus: t
        .input(schemas.update.onStatus.input)
        .output(schemas.update.onStatus.output)
        .handler(async function* ({ context }) {
          const queue = createAsyncEventQueue<UpdateStatus>();
          const unsubscribe = context.updateService.onStatus(queue.push);

          try {
            yield* queue.iterate();
          } finally {
            queue.end();
            unsubscribe();
          }
        }),
    },
    menu: {
      onOpenSettings: t
        .input(schemas.menu.onOpenSettings.input)
        .output(schemas.menu.onOpenSettings.output)
        .handler(async function* ({ context }) {
          // Use a sentinel value to signal events since void/undefined can't be queued
          const queue = createAsyncEventQueue<true>();
          const unsubscribe = context.menuEventService.onOpenSettings(() => queue.push(true));

          try {
            for await (const _ of queue.iterate()) {
              yield undefined;
            }
          } finally {
            queue.end();
            unsubscribe();
          }
        }),
    },
    voice: {
      transcribe: t
        .input(schemas.voice.transcribe.input)
        .output(schemas.voice.transcribe.output)
        .handler(async ({ context, input }) => {
          return context.voiceService.transcribe(input.audioBase64);
        }),
    },
    experiments: {
      getAll: t
        .input(schemas.experiments.getAll.input)
        .output(schemas.experiments.getAll.output)
        .handler(({ context }) => {
          return context.experimentsService.getAll();
        }),
      reload: t
        .input(schemas.experiments.reload.input)
        .output(schemas.experiments.reload.output)
        .handler(async ({ context }) => {
          await context.experimentsService.refreshAll();
        }),
    },
    debug: {
      triggerStreamError: t
        .input(schemas.debug.triggerStreamError.input)
        .output(schemas.debug.triggerStreamError.output)
        .handler(({ context, input }) => {
          return context.workspaceService.debugTriggerStreamError(
            input.workspaceId,
            input.errorMessage
          );
        }),
    },
    telemetry: {
      track: t
        .input(schemas.telemetry.track.input)
        .output(schemas.telemetry.track.output)
        .handler(({ context, input }) => {
          context.telemetryService.capture(input);
        }),
      status: t
        .input(schemas.telemetry.status.input)
        .output(schemas.telemetry.status.output)
        .handler(({ context }) => {
          return {
            enabled: context.telemetryService.isEnabled(),
            explicit: context.telemetryService.isExplicitlyDisabled(),
          };
        }),
    },
    signing: {
      capabilities: t
        .input(schemas.signing.capabilities.input)
        .output(schemas.signing.capabilities.output)
        .handler(async ({ context }) => {
          return context.signingService.getCapabilities();
        }),
      signMessage: t
        .input(schemas.signing.signMessage.input)
        .output(schemas.signing.signMessage.output)
        .handler(({ context, input }) => {
          return context.signingService.signMessage(input.content);
        }),
      clearIdentityCache: t
        .input(schemas.signing.clearIdentityCache.input)
        .output(schemas.signing.clearIdentityCache.output)
        .handler(({ context }) => {
          context.signingService.clearIdentityCache();
          return { success: true };
        }),
    },

    // ─── Inference (Local Models) ──────────────────────────────────────
    inference: {
      getStatus: t
        .input(schemas.inference.getStatus.input)
        .output(schemas.inference.getStatus.output)
        .handler(async ({ context }) => ({
          available: context.inferenceService.isAvailable,
          loadedModelId: context.inferenceService.loadedModelId,
        })),

      listModels: t
        .input(schemas.inference.listModels.input)
        .output(schemas.inference.listModels.output)
        .handler(async ({ context }) => {
          if (!context.inferenceService.isAvailable) return [];
          return context.inferenceService.listModels();
        }),

      pullModel: t
        .input(schemas.inference.pullModel.input)
        .output(schemas.inference.pullModel.output)
        .handler(async ({ context, input }) => {
          const localPath = await context.inferenceService.pullModel(input.modelId);
          return { localPath };
        }),

      deleteModel: t
        .input(schemas.inference.deleteModel.input)
        .output(schemas.inference.deleteModel.output)
        .handler(async ({ context, input }) => {
          await context.inferenceService.deleteModel(input.modelId);
        }),

      loadModel: t
        .input(schemas.inference.loadModel.input)
        .output(schemas.inference.loadModel.output)
        .handler(async ({ context, input }) => {
          await context.inferenceService.loadModel(input.modelId, input.backend);
        }),

      unloadModel: t
        .input(schemas.inference.unloadModel.input)
        .output(schemas.inference.unloadModel.output)
        .handler(async ({ context, input }) => {
          await context.inferenceService.unloadModel(input.modelId);
        }),

      onDownloadProgress: t
        .input(schemas.inference.onDownloadProgress.input)
        .output(schemas.inference.onDownloadProgress.output)
        .handler(async function* ({ context }) {
          yield* asyncEventIterator(
            (handler) => {
              context.inferenceService.on("download-progress", handler);
            },
            (handler) => {
              context.inferenceService.off("download-progress", handler);
            }
          );
        }),

      onStatusChanged: t
        .input(schemas.inference.onStatusChanged.input)
        .output(schemas.inference.onStatusChanged.output)
        .handler(async function* ({ context }) {
          const getStatus = () => ({
            available: context.inferenceService.isAvailable,
            loadedModelId: context.inferenceService.loadedModelId,
          });

          // Yield initial state
          yield getStatus();

          const queue = createAsyncEventQueue<{
            available: boolean;
            loadedModelId: string | null;
          }>();
          const onLoaded = () => queue.push(getStatus());
          const onUnloaded = () => queue.push(getStatus());

          context.inferenceService.on("model-loaded", onLoaded);
          context.inferenceService.on("model-unloaded", onUnloaded);

          try {
            yield* queue.iterate();
          } finally {
            context.inferenceService.off("model-loaded", onLoaded);
            context.inferenceService.off("model-unloaded", onUnloaded);
            queue.end();
          }
        }),

      // ─── Pool (Phase 2) ──────────────────────────────────────────────
      getPoolStatus: t
        .input(schemas.inference.getPoolStatus.input)
        .output(schemas.inference.getPoolStatus.output)
        .handler(async ({ context }) => {
          if (!context.inferenceService.isAvailable) {
            return {
              loadedModels: [],
              modelsLoaded: 0,
              maxLoadedModels: 0,
              memoryBudgetBytes: 0,
              estimatedVramBytes: 0,
            };
          }
          return context.inferenceService.getPoolStatus();
        }),

      getMetrics: t
        .input(schemas.inference.getMetrics.input)
        .output(schemas.inference.getMetrics.output)
        .handler(async ({ context }) => context.inferenceService.getMetrics()),

      // ─── Cluster (Phase 3) ───────────────────────────────────────────
      getClusterStatus: t
        .input(schemas.inference.getClusterStatus.input)
        .output(schemas.inference.getClusterStatus.output)
        .handler(async ({ context }) => context.inferenceService.getClusterStatus()),

      getClusterNodes: t
        .input(schemas.inference.getClusterNodes.input)
        .output(schemas.inference.getClusterNodes.output)
        .handler(async ({ context }) => context.inferenceService.getClusterNodes()),

      // ─── RDMA / Transport (Phase 4+6) ──────────────────────────────────
      getRdmaStatus: t
        .input(schemas.inference.getRdmaStatus.input)
        .output(schemas.inference.getRdmaStatus.output)
        .handler(async ({ context }) => {
          const raw = await context.inferenceService.getRdmaStatus();
          if (!raw) return null;
          return {
            available: raw.available ?? false,
            mode: raw.mode ?? "",
            device: raw.device ?? "",
            backend: raw.backend ?? "tcp",
            bandwidth_gbps: raw.bandwidth_gbps ?? 0,
            latency_us: raw.latency_us ?? 0,
            max_message_size: raw.max_message_size ?? 0,
            error: raw.error,
          };
        }),

      getTransportStatus: t
        .input(schemas.inference.getTransportStatus.input)
        .output(schemas.inference.getTransportStatus.output)
        .handler(async ({ context }) => {
          const raw = await context.inferenceService.getTransportStatus();
          if (!raw) return null;
          // Normalize: Go binary may return undefined/null for optional fields
          return {
            rdma: {
              available: raw.rdma?.available ?? false,
              mode: raw.rdma?.mode ?? "",
              device: raw.rdma?.device ?? "",
              backend: raw.rdma?.backend ?? "tcp",
              bandwidth_gbps: raw.rdma?.bandwidth_gbps ?? 0,
              latency_us: raw.rdma?.latency_us ?? 0,
              max_message_size: raw.rdma?.max_message_size ?? 0,
              error: raw.rdma?.error,
            },
            peer_transports: Array.isArray(raw.peer_transports) ? raw.peer_transports : [],
            router_transports: raw.router_transports ?? {},
          };
        }),

      // ─── System Info ──────────────────────────────────────────────────
      getSystemInfo: t
        .input(schemas.inference.getSystemInfo.input)
        .output(schemas.inference.getSystemInfo.output)
        .handler(async () => {
          const os = await import("node:os");
          const cpus = os.cpus();
          return {
            hostname: os.hostname(),
            username: os.userInfo().username,
            platform: os.platform(),
            arch: os.arch(),
            osType: os.type(),
            osRelease: os.release(),
            cpuModel: cpus[0]?.model ?? "Unknown",
            cpuCores: cpus.length,
            totalMemoryBytes: os.totalmem(),
            freeMemoryBytes: os.freemem(),
            uptime: os.uptime(),
            nodeVersion: process.version,
            pid: process.pid,
          };
        }),

      // ─── Benchmark (Sprint 2) ─────────────────────────────────────────
      runBenchmark: t
        .input(schemas.inference.runBenchmark.input)
        .output(schemas.inference.runBenchmark.output)
        .handler(async ({ context, input }) =>
          context.inferenceService.runBenchmark(input.modelId)
        ),
    },

    // ═══════════════════════════════════════════════════════════════════════
    // ██ Channels — cross-platform messaging adapters (Telegram, Discord…) █
    // ═══════════════════════════════════════════════════════════════════════
    channels: {
      list: t
        .input(schemas.channels.list.input)
        .output(schemas.channels.list.output)
        .handler(async ({ context }) => {
          return context.channelService.listChannels();
        }),

      get: t
        .input(schemas.channels.get.input)
        .output(schemas.channels.get.output)
        .handler(async ({ context, input }) => {
          const config = context.channelService.getConfig(input.accountId);
          if (!config) {
            throw new Error(`Channel "${input.accountId}" not found`);
          }
          return config;
        }),

      create: t
        .input(schemas.channels.create.input)
        .output(schemas.channels.create.output)
        .handler(async ({ context, input }) => {
          return context.channelService.createChannel(input);
        }),

      update: t
        .input(schemas.channels.update.input)
        .output(schemas.channels.update.output)
        .handler(async ({ context, input }) => {
          return context.channelService.updateChannel(input);
        }),

      remove: t
        .input(schemas.channels.remove.input)
        .output(schemas.channels.remove.output)
        .handler(async ({ context, input }) => {
          return context.channelService.removeChannel(input.accountId);
        }),

      connect: t
        .input(schemas.channels.connect.input)
        .output(schemas.channels.connect.output)
        .handler(async ({ context, input }) => {
          return context.channelService.connectChannel(input.accountId);
        }),

      disconnect: t
        .input(schemas.channels.disconnect.input)
        .output(schemas.channels.disconnect.output)
        .handler(async ({ context, input }) => {
          return context.channelService.disconnectChannel(input.accountId);
        }),

      sendMessage: t
        .input(schemas.channels.sendMessage.input)
        .output(schemas.channels.sendMessage.output)
        .handler(async ({ context, input }) => {
          return context.channelService.sendMessage(input.accountId, input.message);
        }),

      onMessage: t
        .input(schemas.channels.onMessage.input)
        .output(schemas.channels.onMessage.output)
        .handler(async function* ({ context, input }) {
          const queue = createAsyncEventQueue<ChannelMessage>();

          const handler = (message: ChannelMessage) => {
            // Filter by accountId if specified
            if (input?.accountId && message.channelAccountId !== input.accountId) {
              return;
            }
            queue.push(message);
          };

          context.channelService.on("message", handler);

          try {
            yield* queue.iterate();
          } finally {
            queue.end();
            context.channelService.off("message", handler);
          }
        }),

      // ─── Session management (OpenClaw pattern) ─────────────────────
      sessions: {
        list: t
          .input(schemas.channels.sessions.list.input)
          .output(schemas.channels.sessions.list.output)
          .handler(async ({ context, input }) => {
            return context.channelSessionRouter.listSessions(input?.accountId);
          }),

        resolve: t
          .input(schemas.channels.sessions.resolve.input)
          .output(schemas.channels.sessions.resolve.output)
          .handler(async ({ context, input }) => {
            return context.channelSessionRouter.lookupSession(
              input.channelType,
              input.accountId,
              input.peerId,
              input.peerKind
            );
          }),
      },
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BROWSER — embedded browser session state for BrowserTab UI
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    browser: {
      /** Get all browser sessions for a workspace + debug URLs for live webview */
      state: t.input(z.object({ workspaceId: z.string() })).handler(async ({ context, input }) => {
        const mgr = context.browserSessionManager;
        const sessions = mgr
          .listSessions(input.workspaceId)
          .map((s) => {
            const info = mgr.getSessionInfo(s.id);
            return info;
          })
          .filter(Boolean);
        const snapshot = mgr.getSnapshot(input.workspaceId);
        const activePageUrl = mgr.getActivePageUrl(input.workspaceId);
        return { sessions, snapshot, activePageUrl };
      }),
    },
  });
};

export type AppRouter = ReturnType<typeof router>;
