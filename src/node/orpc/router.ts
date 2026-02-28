import { os } from "@orpc/server";
import * as schemas from "@/common/orpc/schemas";
import type { ORPCContext } from "./context";
import { Err, Ok } from "@/common/types/result";
import { generateMinionIdentity } from "@/node/services/minionTitleGenerator";
import type {
  UpdateStatus,
  MinionActivitySnapshot,
  MinionChatMessage,
  MinionStatsSnapshot,
  FrontendMinionMetadataSchemaType,
} from "@/common/orpc/types";
import type { MinionMetadata } from "@/common/types/minion";
import type { SshPromptEvent, SshPromptRequest } from "@/common/orpc/schemas/ssh";
import {
  createAuthMiddleware,
  extractClientIpAddress,
  extractCookieValues,
  getFirstHeaderValue,
} from "./authMiddleware";
import { createAsyncMessageQueue } from "@/common/utils/asyncMessageQueue";
import { clearLogFiles, getLogFilePath } from "@/node/services/log";
import type { LogEntry } from "@/node/services/logBuffer";
import { clearLogEntries, subscribeLogFeed } from "@/node/services/logBuffer";
import { createReplayBufferedStreamMessageRelay } from "./replayBufferedStreamMessageRelay";

import { TelegramAdapter } from "@/node/services/inbox/telegramAdapter";
import { createRuntime, checkRuntimeAvailability } from "@/node/runtime/runtimeFactory";
import { createRuntimeForMinion } from "@/node/runtime/runtimeHelpers";
import { hasNonEmptyPlanFile, readPlanFile } from "@/node/utils/runtime/helpers";
import { secretsToRecord } from "@/common/types/secrets";
import { roundToBase2 } from "@/common/telemetry/utils";
import { createAsyncEventQueue } from "@/common/utils/asyncEventIterator";
import { TerminalProfileService } from "@/node/services/terminalProfileService";
import { TERMINAL_PROFILE_DEFINITIONS } from "@/common/constants/terminalProfiles";
import {
  DEFAULT_LAYOUT_PRESETS_CONFIG,
  isLayoutPresetsConfigEmpty,
  normalizeLayoutPresetsConfig,
} from "@/common/types/uiLayouts";
import { normalizeAgentAiDefaults } from "@/common/types/agentAiDefaults";
import { isValidModelFormat } from "@/common/utils/ai/models";
import {
  DEFAULT_TASK_SETTINGS,
  normalizeSidekickAiDefaults,
  normalizeTaskSettings,
} from "@/common/types/tasks";
import {
  normalizeRuntimeEnablement,
  RUNTIME_ENABLEMENT_IDS,
  type RuntimeEnablementId,
} from "@/common/types/runtime";
import {
  discoverAgentSkills,
  discoverAgentSkillsDiagnostics,
  readAgentSkill,
} from "@/node/services/agentSkills/agentSkillsService";
import {
  discoverAgentDefinitions,
  readAgentDefinition,
  resolveAgentFrontmatter,
} from "@/node/services/agentDefinitions/agentDefinitionsService";
import { isAgentEffectivelyDisabled } from "@/node/services/agentDefinitions/agentEnablement";
import { isMinionArchived } from "@/common/utils/archive";
import assert from "node:assert/strict";
import * as fsPromises from "fs/promises";
import * as path from "node:path";

import type { LatticeMessage } from "@/common/types/message";
import { coerceThinkingLevel } from "@/common/types/thinking";
import { normalizeLegacyLatticeMetadata } from "@/node/utils/messages/legacy";
import { log } from "@/node/services/log";
import { SERVER_AUTH_SESSION_COOKIE_NAME } from "@/node/services/serverAuthService";
import {
  readSidekickTranscriptArtifactsFile,
  type SidekickTranscriptArtifactIndexEntry,
} from "@/node/services/sidekickTranscriptArtifacts";
import { getErrorMessage } from "@/common/utils/errors";

/**
 * Resolves runtime and discovery path for agent operations.
 * - When minionId is provided: uses minion's runtime config (SSH, local, worktree)
 * - When only projectPath is provided: uses local runtime with project path
 * - When disableMinionAgents is true: still uses minion runtime but discovers from projectPath
 */
async function resolveAgentDiscoveryContext(
  context: ORPCContext,
  input: { projectPath?: string; minionId?: string; disableMinionAgents?: boolean }
): Promise<{
  runtime: ReturnType<typeof createRuntime>;
  discoveryPath: string;
  metadata?: MinionMetadata;
}> {
  if (!input.projectPath && !input.minionId) {
    throw new Error("Either projectPath or minionId must be provided");
  }

  if (input.minionId) {
    const metadataResult = await context.aiService.getMinionMetadata(input.minionId);
    if (!metadataResult.success) {
      throw new Error(metadataResult.error);
    }
    const metadata = metadataResult.data;
    const runtime = createRuntimeForMinion(metadata);
    // When minion agents disabled, discover from project path instead of worktree
    // (but still use the minion's runtime for SSH compatibility)
    const discoveryPath = input.disableMinionAgents
      ? metadata.projectPath
      : runtime.getMinionPath(metadata.projectPath, metadata.name);
    return { runtime, discoveryPath, metadata };
  }

  // No minion - use local runtime with project path
  const runtime = createRuntime(
    { type: "local", srcBaseDir: context.config.srcDir },
    { projectPath: input.projectPath! }
  );
  return { runtime, discoveryPath: input.projectPath! };
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isPathInsideDir(dirPath: string, filePath: string): boolean {
  const resolvedDir = path.resolve(dirPath);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedDir, resolvedFile);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeLatticeMessageFromDisk(value: unknown): LatticeMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  // Older history may have createdAt serialized as a string; coerce back to Date for ORPC.
  const obj = value as { createdAt?: unknown };
  if (typeof obj.createdAt === "string") {
    const parsed = new Date(obj.createdAt);
    if (Number.isFinite(parsed.getTime())) {
      obj.createdAt = parsed;
    } else {
      delete obj.createdAt;
    }
  }

  return normalizeLegacyLatticeMetadata(value as LatticeMessage);
}

async function readChatJsonlAllowMissing(params: {
  chatPath: string;
  logLabel: string;
}): Promise<LatticeMessage[] | null> {
  try {
    const data = await fsPromises.readFile(params.chatPath, "utf-8");
    const lines = data.split("\n").filter((line) => line.trim());
    const messages: LatticeMessage[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]) as unknown;
        const message = normalizeLatticeMessageFromDisk(parsed);
        if (message) {
          messages.push(message);
        }
      } catch (parseError) {
        log.warn(
          `Skipping malformed JSON at line ${i + 1} in ${params.logLabel}:`,
          getErrorMessage(parseError),
          "\nLine content:",
          lines[i].substring(0, 100) + (lines[i].length > 100 ? "..." : "")
        );
      }
    }

    return messages;
  } catch (error: unknown) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

async function readPartialJsonBestEffort(partialPath: string): Promise<LatticeMessage | null> {
  try {
    const raw = await fsPromises.readFile(partialPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeLatticeMessageFromDisk(parsed);
  } catch (error: unknown) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return null;
    }

    // Never fail transcript viewing because partial.json is corrupted.
    log.warn("Failed to read partial.json for transcript", {
      partialPath,
      error: getErrorMessage(error),
    });
    return null;
  }
}

function mergePartialIntoHistory(messages: LatticeMessage[], partial: LatticeMessage | null): LatticeMessage[] {
  if (!partial) {
    return messages;
  }

  const partialSeq = partial.metadata?.historySequence;
  if (partialSeq === undefined) {
    return [...messages, partial];
  }

  const existingIndex = messages.findIndex((m) => m.metadata?.historySequence === partialSeq);
  if (existingIndex >= 0) {
    const existing = messages[existingIndex];
    const shouldReplace = (partial.parts?.length ?? 0) > (existing.parts?.length ?? 0);
    if (!shouldReplace) {
      return messages;
    }

    const next = [...messages];
    next[existingIndex] = partial;
    return next;
  }

  // Insert by historySequence to keep ordering stable.
  const insertIndex = messages.findIndex((m) => {
    const seq = m.metadata?.historySequence;
    return typeof seq === "number" && seq > partialSeq;
  });

  if (insertIndex < 0) {
    return [...messages, partial];
  }

  const next = [...messages];
  next.splice(insertIndex, 0, partial);
  return next;
}

async function findSidekickTranscriptEntryByScanningSessions(params: {
  sessionsDir: string;
  taskId: string;
}): Promise<{ minionId: string; entry: SidekickTranscriptArtifactIndexEntry } | null> {
  let best: { minionId: string; entry: SidekickTranscriptArtifactIndexEntry } | null = null;

  let dirents: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    dirents = await fsPromises.readdir(params.sessionsDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const minionId = dirent.name;
    if (!minionId) {
      continue;
    }

    const sessionDir = path.join(params.sessionsDir, minionId);
    const artifacts = await readSidekickTranscriptArtifactsFile(sessionDir);
    const entry = artifacts.artifactsByChildTaskId[params.taskId];
    if (!entry) {
      continue;
    }

    if (!best || entry.updatedAtMs > best.entry.updatedAtMs) {
      best = { minionId, entry };
    }
  }

  return best;
}

async function getCurrentServerAuthSessionId(context: ORPCContext): Promise<string | null> {
  const sessionTokens = extractCookieValues(
    context.headers?.cookie,
    SERVER_AUTH_SESSION_COOKIE_NAME
  );
  if (sessionTokens.length === 0) {
    return null;
  }

  for (const sessionToken of sessionTokens) {
    const validation = await context.serverAuthService.validateSessionToken(sessionToken, {
      userAgent: getFirstHeaderValue(context.headers, "user-agent"),
      ipAddress: extractClientIpAddress(context.headers),
    });

    if (validation?.sessionId) {
      return validation.sessionId;
    }
  }

  return null;
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
            input.minionId,
            input.messages,
            input.model,
            context.providerService.getConfig()
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
    serverAuth: {
      listSessions: t
        .input(schemas.serverAuth.listSessions.input)
        .output(schemas.serverAuth.listSessions.output)
        .handler(async ({ context }) => {
          const currentSessionId = await getCurrentServerAuthSessionId(context);
          return context.serverAuthService.listSessions(currentSessionId);
        }),
      revokeSession: t
        .input(schemas.serverAuth.revokeSession.input)
        .output(schemas.serverAuth.revokeSession.output)
        .handler(async ({ context, input }) => {
          const removed = await context.serverAuthService.revokeSession(input.sessionId);
          return { removed };
        }),
      revokeOtherSessions: t
        .input(schemas.serverAuth.revokeOtherSessions.input)
        .output(schemas.serverAuth.revokeOtherSessions.output)
        .handler(async ({ context }) => {
          const currentSessionId = await getCurrentServerAuthSessionId(context);
          const revokedCount =
            await context.serverAuthService.revokeOtherSessions(currentSessionId);
          return { revokedCount };
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
          // Determine governor enrollment: requires both URL and token
          const latticeGovernorUrl = config.latticeGovernorUrl ?? null;
          const latticeGovernorEnrolled = Boolean(config.latticeGovernorUrl && config.latticeGovernorToken);
          return {
            taskSettings: config.taskSettings ?? DEFAULT_TASK_SETTINGS,
            defaultModel: config.defaultModel,
            hiddenModels: config.hiddenModels,
            preferredCompactionModel: config.preferredCompactionModel,
            stopLatticeMinionOnArchive: config.stopLatticeMinionOnArchive !== false,
            runtimeEnablement: normalizeRuntimeEnablement(config.runtimeEnablement),
            defaultRuntime: config.defaultRuntime ?? null,
            agentAiDefaults: config.agentAiDefaults ?? {},
            // Legacy fields (downgrade compatibility)
            sidekickAiDefaults: config.sidekickAiDefaults ?? {},
            // Lattice Governor enrollment status (safe fields only - token never exposed)
            latticeGovernorUrl,
            latticeGovernorEnrolled,
          };
        }),
      updateAgentAiDefaults: t
        .input(schemas.config.updateAgentAiDefaults.input)
        .output(schemas.config.updateAgentAiDefaults.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            const normalized = normalizeAgentAiDefaults(input.agentAiDefaults);

            const legacySidekickDefaultsRaw: Record<string, unknown> = {};
            for (const [agentType, entry] of Object.entries(normalized)) {
              if (agentType === "plan" || agentType === "exec" || agentType === "compact") {
                continue;
              }
              legacySidekickDefaultsRaw[agentType] = entry;
            }

            const legacySidekickDefaults = normalizeSidekickAiDefaults(legacySidekickDefaultsRaw);

            return {
              ...config,
              agentAiDefaults: Object.keys(normalized).length > 0 ? normalized : undefined,
              // Legacy fields (downgrade compatibility)
              sidekickAiDefaults:
                Object.keys(legacySidekickDefaults).length > 0 ? legacySidekickDefaults : undefined,
            };
          });
        }),
      updateModelPreferences: t
        .input(schemas.config.updateModelPreferences.input)
        .output(schemas.config.updateModelPreferences.output)
        .handler(async ({ context, input }) => {
          const normalizeModelString = (value: string): string | undefined => {
            const trimmed = value.trim();
            if (!trimmed) {
              return undefined;
            }

            if (!isValidModelFormat(trimmed)) {
              return undefined;
            }

            return trimmed;
          };

          await context.config.editConfig((config) => {
            const next = { ...config };

            if (input.defaultModel !== undefined) {
              next.defaultModel = normalizeModelString(input.defaultModel);
            }

            if (input.hiddenModels !== undefined) {
              const seen = new Set<string>();
              const normalizedHidden: string[] = [];

              for (const modelString of input.hiddenModels) {
                const normalized = normalizeModelString(modelString);
                if (!normalized) continue;
                if (seen.has(normalized)) continue;
                seen.add(normalized);
                normalizedHidden.push(normalized);
              }

              next.hiddenModels = normalizedHidden;
            }

            if (input.preferredCompactionModel !== undefined) {
              next.preferredCompactionModel = normalizeModelString(input.preferredCompactionModel);
            }

            return next;
          });
        }),
      updateLatticePrefs: t
        .input(schemas.config.updateLatticePrefs.input)
        .output(schemas.config.updateLatticePrefs.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            return {
              ...config,
              // Default ON: store `false` only.
              stopLatticeMinionOnArchive: input.stopLatticeMinionOnArchive ? undefined : false,
            };
          });
        }),
      updateRuntimeEnablement: t
        .input(schemas.config.updateRuntimeEnablement.input)
        .output(schemas.config.updateRuntimeEnablement.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((config) => {
            const shouldUpdateRuntimeEnablement = input.runtimeEnablement !== undefined;
            const shouldUpdateDefaultRuntime = input.defaultRuntime !== undefined;
            const shouldUpdateOverridesEnabled = input.runtimeOverridesEnabled !== undefined;
            const projectPath = input.projectPath?.trim();

            if (
              !shouldUpdateRuntimeEnablement &&
              !shouldUpdateDefaultRuntime &&
              !shouldUpdateOverridesEnabled
            ) {
              return config;
            }

            const runtimeEnablementOverrides =
              input.runtimeEnablement == null
                ? undefined
                : (() => {
                    const normalized = normalizeRuntimeEnablement(input.runtimeEnablement);
                    const disabled: Partial<Record<RuntimeEnablementId, false>> = {};

                    for (const runtimeId of RUNTIME_ENABLEMENT_IDS) {
                      if (!normalized[runtimeId]) {
                        disabled[runtimeId] = false;
                      }
                    }

                    return Object.keys(disabled).length > 0 ? disabled : undefined;
                  })();

            const defaultRuntime = input.defaultRuntime ?? undefined;
            const runtimeOverridesEnabled =
              input.runtimeOverridesEnabled === true ? true : undefined;

            if (projectPath) {
              const project = config.projects.get(projectPath);
              if (!project) {
                log.warn("Runtime settings update requested for missing project", { projectPath });
                return config;
              }

              const nextProject = { ...project };

              if (shouldUpdateRuntimeEnablement) {
                if (runtimeEnablementOverrides) {
                  nextProject.runtimeEnablement = runtimeEnablementOverrides;
                } else {
                  delete nextProject.runtimeEnablement;
                }
              }

              if (shouldUpdateDefaultRuntime) {
                if (defaultRuntime !== undefined) {
                  nextProject.defaultRuntime = defaultRuntime;
                } else {
                  delete nextProject.defaultRuntime;
                }
              }

              if (shouldUpdateOverridesEnabled) {
                if (runtimeOverridesEnabled) {
                  nextProject.runtimeOverridesEnabled = true;
                } else {
                  delete nextProject.runtimeOverridesEnabled;
                }
              }
              const nextProjects = new Map(config.projects);
              nextProjects.set(projectPath, nextProject);
              return { ...config, projects: nextProjects };
            }

            const next = { ...config };
            if (shouldUpdateRuntimeEnablement) {
              next.runtimeEnablement = runtimeEnablementOverrides;
            }

            if (shouldUpdateDefaultRuntime) {
              next.defaultRuntime = defaultRuntime;
            }

            return next;
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

              if (input.sidekickAiDefaults === undefined) {
                const legacySidekickDefaultsRaw: Record<string, unknown> = {};
                for (const [agentType, entry] of Object.entries(normalized)) {
                  if (agentType === "plan" || agentType === "exec" || agentType === "compact") {
                    continue;
                  }
                  legacySidekickDefaultsRaw[agentType] = entry;
                }

                const legacySidekickDefaults =
                  normalizeSidekickAiDefaults(legacySidekickDefaultsRaw);
                result.sidekickAiDefaults =
                  Object.keys(legacySidekickDefaults).length > 0
                    ? legacySidekickDefaults
                    : undefined;
              }
            }

            if (input.sidekickAiDefaults !== undefined) {
              const normalizedDefaults = normalizeSidekickAiDefaults(input.sidekickAiDefaults);
              result.sidekickAiDefaults =
                Object.keys(normalizedDefaults).length > 0 ? normalizedDefaults : undefined;

              // Downgrade compatibility: keep agentAiDefaults in sync with legacy sidekickAiDefaults.
              // Only mutate keys previously managed by sidekickAiDefaults so we don't clobber other
              // agent defaults (e.g., UI-selectable custom agents).
              const previousLegacy = config.sidekickAiDefaults ?? {};
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
      unenrollLatticeGovernor: t
        .input(schemas.config.unenrollLatticeGovernor.input)
        .output(schemas.config.unenrollLatticeGovernor.output)
        .handler(async ({ context }) => {
          await context.config.editConfig((config) => {
            const { latticeGovernorUrl: _url, latticeGovernorToken: _token, ...rest } = config;
            return rest;
          });

          await context.policyService.refreshNow();
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
          // Wait for minion init before discovery (SSH may not be ready yet)
          if (input.minionId) {
            await context.aiService.waitForInit(input.minionId);
          }

          const { runtime, discoveryPath, metadata } = await resolveAgentDiscoveryContext(
            context,
            input
          );

          // Agents can require a plan file before they're selectable (e.g., orchestrator).
          // Fail closed: if plan state cannot be determined, treat it as missing.
          let planReady = false;
          if (input.minionId && metadata) {
            try {
              planReady = await hasNonEmptyPlanFile(
                runtime,
                metadata.name,
                metadata.projectName,
                input.minionId
              );
            } catch {
              planReady = false;
            }
          }

          const descriptors = await discoverAgentDefinitions(runtime, discoveryPath);

          const cfg = context.config.loadConfigOrDefault();

          const resolved = await Promise.all(
            descriptors.map(async (descriptor) => {
              try {
                const resolvedFrontmatter = await resolveAgentFrontmatter(
                  runtime,
                  discoveryPath,
                  descriptor.id
                );

                const effectivelyDisabled = isAgentEffectivelyDisabled({
                  cfg,
                  agentId: descriptor.id,
                  resolvedFrontmatter,
                });

                // By default, disabled agents are omitted from discovery so they cannot be
                // selected or cycled in the UI.
                //
                // Settings passes includeDisabled: true so users can opt in/out locally.
                if (effectivelyDisabled && input.includeDisabled !== true) {
                  return null;
                }

                // NOTE: hidden is opt-out. selectable is legacy opt-in.
                const uiSelectableBase =
                  typeof resolvedFrontmatter.ui?.hidden === "boolean"
                    ? !resolvedFrontmatter.ui.hidden
                    : typeof resolvedFrontmatter.ui?.selectable === "boolean"
                      ? resolvedFrontmatter.ui.selectable
                      : true;

                const requiresPlan = resolvedFrontmatter.ui?.requires?.includes("plan") ?? false;
                const uiSelectable = requiresPlan && !planReady ? false : uiSelectableBase;

                return {
                  ...descriptor,
                  name: resolvedFrontmatter.name,
                  description: resolvedFrontmatter.description,
                  uiSelectable,
                  uiColor: resolvedFrontmatter.ui?.color,
                  sidekickRunnable: resolvedFrontmatter.sidekick?.runnable ?? false,
                  base: resolvedFrontmatter.base,
                  aiDefaults: resolvedFrontmatter.ai,
                  tools: resolvedFrontmatter.tools,
                };
              } catch {
                return descriptor;
              }
            })
          );

          return resolved.filter((descriptor): descriptor is NonNullable<typeof descriptor> =>
            Boolean(descriptor)
          );
        }),
      get: t
        .input(schemas.agents.get.input)
        .output(schemas.agents.get.output)
        .handler(async ({ context, input }) => {
          // Wait for minion init before discovery (SSH may not be ready yet)
          if (input.minionId) {
            await context.aiService.waitForInit(input.minionId);
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
          // Wait for minion init before agent discovery (SSH may not be ready yet)
          if (input.minionId) {
            await context.aiService.waitForInit(input.minionId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          return discoverAgentSkills(runtime, discoveryPath);
        }),
      listDiagnostics: t
        .input(schemas.agentSkills.listDiagnostics.input)
        .output(schemas.agentSkills.listDiagnostics.output)
        .handler(async ({ context, input }) => {
          // Wait for minion init before agent discovery (SSH may not be ready yet)
          if (input.minionId) {
            await context.aiService.waitForInit(input.minionId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          return discoverAgentSkillsDiagnostics(runtime, discoveryPath);
        }),
      get: t
        .input(schemas.agentSkills.get.input)
        .output(schemas.agentSkills.get.output)
        .handler(async ({ context, input }) => {
          // Wait for minion init before agent discovery (SSH may not be ready yet)
          if (input.minionId) {
            await context.aiService.waitForInit(input.minionId);
          }
          const { runtime, discoveryPath } = await resolveAgentDiscoveryContext(context, input);
          const result = await readAgentSkill(runtime, discoveryPath, input.skillName);
          return result.package;
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
      onConfigChanged: t
        .input(schemas.providers.onConfigChanged.input)
        .output(schemas.providers.onConfigChanged.output)
        .handler(async function* ({ context, signal }) {
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

          // Consumers often cancel this subscription while there are no pending provider changes.
          // If we block on a never-resolving Promise, AbortSignal cancellation can't unwind the
          // generator, and we leak EventEmitter listeners across tests.
          const onAbort = () => {
            if (ended) return;
            ended = true;
            // Wake up the iterator if it's currently waiting.
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve();
            } else {
              pendingNotification = true;
            }
          };

          if (signal) {
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }

          try {
            while (!ended) {
              // If notification arrived before we started waiting, yield immediately
              if (pendingNotification) {
                pendingNotification = false;
                if (ended) break;
                yield undefined;
                continue;
              }

              // Wait for next notification (or abort)
              await new Promise<void>((resolve) => {
                resolveNext = resolve;
              });

              if (ended) break;
              yield undefined;
            }
          } finally {
            ended = true;
            signal?.removeEventListener("abort", onAbort);
            unsubscribe();
          }
        }),
    },
    policy: {
      get: t
        .input(schemas.policy.get.input)
        .output(schemas.policy.get.output)
        .handler(({ context }) => context.policyService.getPolicyGetResponse()),
      onChanged: t
        .input(schemas.policy.onChanged.input)
        .output(schemas.policy.onChanged.output)
        .handler(async function* ({ context, signal }) {
          let resolveNext: (() => void) | null = null;
          let pendingNotification = false;
          let ended = false;

          const push = () => {
            if (ended) return;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve();
            } else {
              pendingNotification = true;
            }
          };

          const unsubscribe = context.policyService.onPolicyChanged(push);

          const onAbort = () => {
            if (ended) return;
            ended = true;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve();
            } else {
              pendingNotification = true;
            }
          };

          if (signal) {
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }

          try {
            while (!ended) {
              if (pendingNotification) {
                pendingNotification = false;
                if (ended) break;
                yield undefined;
                continue;
              }

              await new Promise<void>((resolve) => {
                resolveNext = resolve;
              });

              if (ended) break;
              yield undefined;
            }
          } finally {
            ended = true;
            signal?.removeEventListener("abort", onAbort);
            unsubscribe();
          }
        }),
      refreshNow: t
        .input(schemas.policy.refreshNow.input)
        .output(schemas.policy.refreshNow.output)
        .handler(async ({ context }) => {
          const result = await context.policyService.refreshNow();
          if (!result.success) {
            return Err(result.error);
          }
          return Ok(context.policyService.getPolicyGetResponse());
        }),
    },
    copilotOauth: {
      startDeviceFlow: t
        .input(schemas.copilotOauth.startDeviceFlow.input)
        .output(schemas.copilotOauth.startDeviceFlow.output)
        .handler(({ context }) => {
          return context.copilotOauthService.startDeviceFlow();
        }),
      waitForDeviceFlow: t
        .input(schemas.copilotOauth.waitForDeviceFlow.input)
        .output(schemas.copilotOauth.waitForDeviceFlow.output)
        .handler(({ context, input }) => {
          return context.copilotOauthService.waitForDeviceFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelDeviceFlow: t
        .input(schemas.copilotOauth.cancelDeviceFlow.input)
        .output(schemas.copilotOauth.cancelDeviceFlow.output)
        .handler(({ context, input }) => {
          context.copilotOauthService.cancelDeviceFlow(input.flowId);
        }),
    },
    latticeGovernorOauth: {
      startDesktopFlow: t
        .input(schemas.latticeGovernorOauth.startDesktopFlow.input)
        .output(schemas.latticeGovernorOauth.startDesktopFlow.output)
        .handler(({ context, input }) => {
          return context.latticeGovernorOauthService.startDesktopFlow({
            governorOrigin: input.governorOrigin,
          });
        }),
      waitForDesktopFlow: t
        .input(schemas.latticeGovernorOauth.waitForDesktopFlow.input)
        .output(schemas.latticeGovernorOauth.waitForDesktopFlow.output)
        .handler(({ context, input }) => {
          return context.latticeGovernorOauthService.waitForDesktopFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelDesktopFlow: t
        .input(schemas.latticeGovernorOauth.cancelDesktopFlow.input)
        .output(schemas.latticeGovernorOauth.cancelDesktopFlow.output)
        .handler(async ({ context, input }) => {
          await context.latticeGovernorOauthService.cancelDesktopFlow(input.flowId);
        }),
    },
    codexOauth: {
      startDesktopFlow: t
        .input(schemas.codexOauth.startDesktopFlow.input)
        .output(schemas.codexOauth.startDesktopFlow.output)
        .handler(({ context }) => {
          return context.codexOauthService.startDesktopFlow();
        }),
      waitForDesktopFlow: t
        .input(schemas.codexOauth.waitForDesktopFlow.input)
        .output(schemas.codexOauth.waitForDesktopFlow.output)
        .handler(({ context, input }) => {
          return context.codexOauthService.waitForDesktopFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelDesktopFlow: t
        .input(schemas.codexOauth.cancelDesktopFlow.input)
        .output(schemas.codexOauth.cancelDesktopFlow.output)
        .handler(async ({ context, input }) => {
          await context.codexOauthService.cancelDesktopFlow(input.flowId);
        }),
      startDeviceFlow: t
        .input(schemas.codexOauth.startDeviceFlow.input)
        .output(schemas.codexOauth.startDeviceFlow.output)
        .handler(({ context }) => {
          return context.codexOauthService.startDeviceFlow();
        }),
      waitForDeviceFlow: t
        .input(schemas.codexOauth.waitForDeviceFlow.input)
        .output(schemas.codexOauth.waitForDeviceFlow.output)
        .handler(({ context, input }) => {
          return context.codexOauthService.waitForDeviceFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelDeviceFlow: t
        .input(schemas.codexOauth.cancelDeviceFlow.input)
        .output(schemas.codexOauth.cancelDeviceFlow.output)
        .handler(async ({ context, input }) => {
          await context.codexOauthService.cancelDeviceFlow(input.flowId);
        }),
      disconnect: t
        .input(schemas.codexOauth.disconnect.input)
        .output(schemas.codexOauth.disconnect.output)
        .handler(({ context }) => {
          return context.codexOauthService.disconnect();
        }),
    },
    anthropicOauth: {
      startFlow: t
        .input(schemas.anthropicOauth.startFlow.input)
        .output(schemas.anthropicOauth.startFlow.output)
        .handler(({ context }) => {
          return context.anthropicOauthService.startFlow();
        }),
      submitCode: t
        .input(schemas.anthropicOauth.submitCode.input)
        .output(schemas.anthropicOauth.submitCode.output)
        .handler(({ context, input }) => {
          return context.anthropicOauthService.submitCode(input.flowId, input.code);
        }),
      waitForFlow: t
        .input(schemas.anthropicOauth.waitForFlow.input)
        .output(schemas.anthropicOauth.waitForFlow.output)
        .handler(({ context, input }) => {
          return context.anthropicOauthService.waitForFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelFlow: t
        .input(schemas.anthropicOauth.cancelFlow.input)
        .output(schemas.anthropicOauth.cancelFlow.output)
        .handler(({ context, input }) => {
          context.anthropicOauthService.cancelFlow(input.flowId);
        }),
      disconnect: t
        .input(schemas.anthropicOauth.disconnect.input)
        .output(schemas.anthropicOauth.disconnect.output)
        .handler(({ context }) => {
          return context.anthropicOauthService.disconnect();
        }),
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
      getLogPath: t
        .input(schemas.general.getLogPath.input)
        .output(schemas.general.getLogPath.output)
        .handler(() => {
          return { path: getLogFilePath() };
        }),
      clearLogs: t
        .input(schemas.general.clearLogs.input)
        .output(schemas.general.clearLogs.output)
        .handler(async () => {
          try {
            await clearLogFiles();
            clearLogEntries();
            return { success: true };
          } catch (err) {
            const message = getErrorMessage(err);
            return { success: false, error: message };
          }
        }),
      subscribeLogs: t
        .input(schemas.general.subscribeLogs.input)
        .output(schemas.general.subscribeLogs.output)
        .handler(async function* ({ input, signal }) {
          const LOG_LEVEL_PRIORITY: Record<LogEntry["level"], number> = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
          };

          function shouldInclude(
            entryLevel: LogEntry["level"],
            minLevel: LogEntry["level"]
          ): boolean {
            return (
              (LOG_LEVEL_PRIORITY[entryLevel] ?? LOG_LEVEL_PRIORITY.debug) <=
              (LOG_LEVEL_PRIORITY[minLevel] ?? LOG_LEVEL_PRIORITY.info)
            );
          }

          const minLevel = input.level ?? "info";

          const queue = createAsyncMessageQueue<
            | { type: "snapshot"; epoch: number; entries: LogEntry[] }
            | { type: "append"; epoch: number; entries: LogEntry[] }
            | { type: "reset"; epoch: number }
          >();

          // Atomic handshake: register listener + snapshot in one step.
          // No events can be lost between snapshot and subscription.
          const { snapshot, unsubscribe } = subscribeLogFeed((event) => {
            if (signal?.aborted) {
              return;
            }

            if (event.type === "append") {
              if (shouldInclude(event.entry.level, minLevel)) {
                queue.push({ type: "append", epoch: event.epoch, entries: [event.entry] });
              }
              return;
            }

            queue.push({ type: "reset", epoch: event.epoch });
          }, minLevel);

          queue.push({
            type: "snapshot",
            epoch: snapshot.epoch,
            entries: snapshot.entries.filter((e) => shouldInclude(e.level, minLevel)),
          });

          const onAbort = () => {
            queue.end();
          };
          signal?.addEventListener("abort", onAbort);

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            unsubscribe();
            queue.end();
          }
        }),
      openInEditor: t
        .input(schemas.general.openInEditor.input)
        .output(schemas.general.openInEditor.output)
        .handler(async ({ context, input }) => {
          return context.editorService.openInEditor(
            input.minionId,
            input.targetPath,
            input.editorConfig
          );
        }),
    },
    secrets: {
      get: t
        .input(schemas.secrets.get.input)
        .output(schemas.secrets.get.output)
        .handler(({ context, input }) => {
          const projectPath =
            typeof input.projectPath === "string" && input.projectPath.trim().length > 0
              ? input.projectPath
              : undefined;

          return projectPath
            ? context.config.getProjectSecrets(projectPath)
            : context.config.getGlobalSecrets();
        }),
      update: t
        .input(schemas.secrets.update.input)
        .output(schemas.secrets.update.output)
        .handler(async ({ context, input }) => {
          const projectPath =
            typeof input.projectPath === "string" && input.projectPath.trim().length > 0
              ? input.projectPath
              : undefined;

          try {
            if (projectPath) {
              await context.config.updateProjectSecrets(projectPath, input.secrets);
            } else {
              await context.config.updateGlobalSecrets(input.secrets);
            }

            return Ok(undefined);
          } catch (error) {
            const message = getErrorMessage(error);
            return Err(message);
          }
        }),
    },
    mcp: {
      list: t
        .input(schemas.mcp.list.input)
        .output(schemas.mcp.list.output)
        .handler(async ({ context, input }) => {
          const configServers = await context.mcpConfigService.listServers(input.projectPath);

          // Merge built-in inline servers (always enabled, marked as builtin)
          const inlineServers = context.mcpServerManager.getInlineServers();
          const builtinAsInfo: Record<string, (typeof configServers)[string]> = {};
          for (const [name, command] of Object.entries(inlineServers)) {
            builtinAsInfo[name] = { transport: "stdio", command, disabled: false, builtin: true };
          }
          // Built-in servers override config (cannot be removed/disabled)
          const servers = { ...configServers, ...builtinAsInfo };

          if (!context.policyService.isEnforced()) {
            return servers;
          }

          const filtered: typeof servers = {};
          for (const [name, info] of Object.entries(servers)) {
            if (context.policyService.isMcpTransportAllowed(info.transport)) {
              filtered[name] = info;
            }
          }

          return filtered;
        }),
      add: t
        .input(schemas.mcp.add.input)
        .output(schemas.mcp.add.output)
        .handler(async ({ context, input }) => {
          const existing = await context.mcpConfigService.listServers();
          const existingServer = existing[input.name];

          const transport = input.transport ?? "stdio";
          if (context.policyService.isEnforced()) {
            if (!context.policyService.isMcpTransportAllowed(transport)) {
              return { success: false, error: "MCP transport is disabled by policy" };
            }
          }

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

          const result = await context.mcpConfigService.addServer(input.name, {
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
        .input(schemas.mcp.remove.input)
        .output(schemas.mcp.remove.output)
        .handler(async ({ context, input }) => {
          const existing = await context.mcpConfigService.listServers();
          const server = existing[input.name];

          if (context.policyService.isEnforced() && server) {
            if (!context.policyService.isMcpTransportAllowed(server.transport)) {
              return { success: false, error: "MCP transport is disabled by policy" };
            }
          }

          const result = await context.mcpConfigService.removeServer(input.name);

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
        .input(schemas.mcp.test.input)
        .output(schemas.mcp.test.output)
        .handler(async ({ context, input }) => {
          const start = Date.now();

          const projectPathProvided =
            typeof input.projectPath === "string" && input.projectPath.trim().length > 0;
          const resolvedProjectPath = projectPathProvided
            ? input.projectPath!
            : context.config.rootDir;

          const secrets = secretsToRecord(
            projectPathProvided
              ? context.config.getEffectiveSecrets(resolvedProjectPath)
              : context.config.getGlobalSecrets()
          );

          const configuredTransport = input.name
            ? (
                await context.mcpConfigService.listServers(
                  projectPathProvided ? resolvedProjectPath : undefined
                )
              )[input.name]?.transport
            : undefined;

          const transport =
            configuredTransport ?? (input.command ? "stdio" : (input.transport ?? "auto"));

          if (context.policyService.isEnforced()) {
            if (!context.policyService.isMcpTransportAllowed(transport)) {
              return { success: false, error: "MCP transport is disabled by policy" };
            }
          }

          const result = await context.mcpServerManager.test({
            projectPath: resolvedProjectPath,
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
        .input(schemas.mcp.setEnabled.input)
        .output(schemas.mcp.setEnabled.output)
        .handler(async ({ context, input }) => {
          const existing = await context.mcpConfigService.listServers();
          const server = existing[input.name];

          if (context.policyService.isEnforced() && server) {
            if (!context.policyService.isMcpTransportAllowed(server.transport)) {
              return { success: false, error: "MCP transport is disabled by policy" };
            }
          }

          const result = await context.mcpConfigService.setServerEnabled(input.name, input.enabled);

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
        .input(schemas.mcp.setToolAllowlist.input)
        .output(schemas.mcp.setToolAllowlist.output)
        .handler(async ({ context, input }) => {
          const existing = await context.mcpConfigService.listServers();
          const server = existing[input.name];

          if (context.policyService.isEnforced() && server) {
            if (!context.policyService.isMcpTransportAllowed(server.transport)) {
              return { success: false, error: "MCP transport is disabled by policy" };
            }
          }

          const result = await context.mcpConfigService.setToolAllowlist(
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
    mcpOauth: {
      startDesktopFlow: t
        .input(schemas.mcpOauth.startDesktopFlow.input)
        .output(schemas.mcpOauth.startDesktopFlow.output)
        .handler(async ({ context, input }) => {
          // Global MCP settings can start OAuth without selecting a project.
          // Use lattice home as a stable fallback so existing flow codepaths remain unchanged.
          const projectPath = input.projectPath ?? context.config.rootDir;

          return context.mcpOauthService.startDesktopFlow({ ...input, projectPath });
        }),
      waitForDesktopFlow: t
        .input(schemas.mcpOauth.waitForDesktopFlow.input)
        .output(schemas.mcpOauth.waitForDesktopFlow.output)
        .handler(async ({ context, input }) => {
          return context.mcpOauthService.waitForDesktopFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelDesktopFlow: t
        .input(schemas.mcpOauth.cancelDesktopFlow.input)
        .output(schemas.mcpOauth.cancelDesktopFlow.output)
        .handler(async ({ context, input }) => {
          await context.mcpOauthService.cancelDesktopFlow(input.flowId);
        }),
      startServerFlow: t
        .input(schemas.mcpOauth.startServerFlow.input)
        .output(schemas.mcpOauth.startServerFlow.output)
        .handler(async ({ context, input }) => {
          // Global MCP settings can start OAuth without selecting a project.
          // Use lattice home as a stable fallback so existing flow codepaths remain unchanged.
          const projectPath = input.projectPath ?? context.config.rootDir;

          const headers = context.headers;

          const origin = typeof headers?.origin === "string" ? headers.origin.trim() : "";
          if (origin) {
            try {
              const redirectUri = new URL("/auth/mcp-oauth/callback", origin).toString();
              return context.mcpOauthService.startServerFlow({
                ...input,
                projectPath,
                redirectUri,
              });
            } catch {
              // Fall back to Host header.
            }
          }

          const hostHeader = headers?.["x-forwarded-host"] ?? headers?.host;
          const host = typeof hostHeader === "string" ? hostHeader.split(",")[0]?.trim() : "";
          if (!host) {
            return Err("Missing Host header");
          }

          const protoHeader = headers?.["x-forwarded-proto"];
          const forwardedProto =
            typeof protoHeader === "string" ? protoHeader.split(",")[0]?.trim() : "";
          const proto = forwardedProto.length ? forwardedProto : "http";

          const redirectUri = `${proto}://${host}/auth/mcp-oauth/callback`;

          return context.mcpOauthService.startServerFlow({
            ...input,
            projectPath,
            redirectUri,
          });
        }),
      waitForServerFlow: t
        .input(schemas.mcpOauth.waitForServerFlow.input)
        .output(schemas.mcpOauth.waitForServerFlow.output)
        .handler(async ({ context, input }) => {
          return context.mcpOauthService.waitForServerFlow(input.flowId, {
            timeoutMs: input.timeoutMs,
          });
        }),
      cancelServerFlow: t
        .input(schemas.mcpOauth.cancelServerFlow.input)
        .output(schemas.mcpOauth.cancelServerFlow.output)
        .handler(async ({ context, input }) => {
          await context.mcpOauthService.cancelServerFlow(input.flowId);
        }),
      getAuthStatus: t
        .input(schemas.mcpOauth.getAuthStatus.input)
        .output(schemas.mcpOauth.getAuthStatus.output)
        .handler(async ({ context, input }) => {
          return context.mcpOauthService.getAuthStatus({ serverUrl: input.serverUrl });
        }),
      logout: t
        .input(schemas.mcpOauth.logout.input)
        .output(schemas.mcpOauth.logout.output)
        .handler(async ({ context, input }) => {
          return context.mcpOauthService.logout({ serverUrl: input.serverUrl });
        }),
    },
    projects: {
      list: t
        .input(schemas.projects.list.input)
        .output(schemas.projects.list.output)
        .handler(async ({ context }) => {
          return context.projectService.list();
        }),
      create: t
        .input(schemas.projects.create.input)
        .output(schemas.projects.create.output)
        .handler(async ({ context, input }) => {
          return context.projectService.create(input.projectPath);
        }),
      getDefaultProjectDir: t
        .input(schemas.projects.getDefaultProjectDir.input)
        .output(schemas.projects.getDefaultProjectDir.output)
        .handler(({ context }) => {
          return context.projectService.getDefaultProjectDir();
        }),
      setDefaultProjectDir: t
        .input(schemas.projects.setDefaultProjectDir.input)
        .output(schemas.projects.setDefaultProjectDir.output)
        .handler(async ({ context, input }) => {
          await context.projectService.setDefaultProjectDir(input.path);
        }),
      clone: t
        .input(schemas.projects.clone.input)
        .output(schemas.projects.clone.output)
        .handler(async function* ({ context, input, signal }) {
          yield* context.projectService.cloneWithProgress(input, signal);
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
          return context.projectService.remove(input.projectPath);
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
          .handler(async ({ context, input }) => {
            const servers = await context.mcpConfigService.listServers(input.projectPath);

            if (!context.policyService.isEnforced()) {
              return servers;
            }

            const filtered: typeof servers = {};
            for (const [name, info] of Object.entries(servers)) {
              if (context.policyService.isMcpTransportAllowed(info.transport)) {
                filtered[name] = info;
              }
            }

            return filtered;
          }),
        add: t
          .input(schemas.projects.mcp.add.input)
          .output(schemas.projects.mcp.add.output)
          .handler(async ({ context, input }) => {
            const existing = await context.mcpConfigService.listServers();
            const existingServer = existing[input.name];

            const transport = input.transport ?? "stdio";
            if (context.policyService.isEnforced()) {
              if (!context.policyService.isMcpTransportAllowed(transport)) {
                return { success: false, error: "MCP transport is disabled by policy" };
              }
            }
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

            const result = await context.mcpConfigService.addServer(input.name, {
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
            const existing = await context.mcpConfigService.listServers();
            const server = existing[input.name];

            if (context.policyService.isEnforced() && server) {
              if (!context.policyService.isMcpTransportAllowed(server.transport)) {
                return { success: false, error: "MCP transport is disabled by policy" };
              }
            }

            const result = await context.mcpConfigService.removeServer(input.name);

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
            const secrets = secretsToRecord(context.config.getEffectiveSecrets(input.projectPath));

            const configuredTransport = input.name
              ? (await context.mcpConfigService.listServers(input.projectPath))[input.name]
                  ?.transport
              : undefined;

            const transport =
              configuredTransport ?? (input.command ? "stdio" : (input.transport ?? "auto"));

            if (context.policyService.isEnforced()) {
              if (!context.policyService.isMcpTransportAllowed(transport)) {
                return { success: false, error: "MCP transport is disabled by policy" };
              }
            }

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
            const existing = await context.mcpConfigService.listServers();
            const server = existing[input.name];

            if (context.policyService.isEnforced() && server) {
              if (!context.policyService.isMcpTransportAllowed(server.transport)) {
                return { success: false, error: "MCP transport is disabled by policy" };
              }
            }

            const result = await context.mcpConfigService.setServerEnabled(
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
            const existing = await context.mcpConfigService.listServers();
            const server = existing[input.name];

            if (context.policyService.isEnforced() && server) {
              if (!context.policyService.isMcpTransportAllowed(server.transport)) {
                return { success: false, error: "MCP transport is disabled by policy" };
              }
            }

            const result = await context.mcpConfigService.setToolAllowlist(
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
      mcpOauth: {
        startDesktopFlow: t
          .input(schemas.projects.mcpOauth.startDesktopFlow.input)
          .output(schemas.projects.mcpOauth.startDesktopFlow.output)
          .handler(async ({ context, input }) => {
            return context.mcpOauthService.startDesktopFlow(input);
          }),
        waitForDesktopFlow: t
          .input(schemas.projects.mcpOauth.waitForDesktopFlow.input)
          .output(schemas.projects.mcpOauth.waitForDesktopFlow.output)
          .handler(async ({ context, input }) => {
            return context.mcpOauthService.waitForDesktopFlow(input.flowId, {
              timeoutMs: input.timeoutMs,
            });
          }),
        cancelDesktopFlow: t
          .input(schemas.projects.mcpOauth.cancelDesktopFlow.input)
          .output(schemas.projects.mcpOauth.cancelDesktopFlow.output)
          .handler(async ({ context, input }) => {
            await context.mcpOauthService.cancelDesktopFlow(input.flowId);
          }),
        startServerFlow: t
          .input(schemas.projects.mcpOauth.startServerFlow.input)
          .output(schemas.projects.mcpOauth.startServerFlow.output)
          .handler(async ({ context, input }) => {
            const headers = context.headers;

            const origin = typeof headers?.origin === "string" ? headers.origin.trim() : "";
            if (origin) {
              try {
                const redirectUri = new URL("/auth/mcp-oauth/callback", origin).toString();
                return context.mcpOauthService.startServerFlow({ ...input, redirectUri });
              } catch {
                // Fall back to Host header.
              }
            }

            const hostHeader = headers?.["x-forwarded-host"] ?? headers?.host;
            const host = typeof hostHeader === "string" ? hostHeader.split(",")[0]?.trim() : "";
            if (!host) {
              return Err("Missing Host header");
            }

            const protoHeader = headers?.["x-forwarded-proto"];
            const forwardedProto =
              typeof protoHeader === "string" ? protoHeader.split(",")[0]?.trim() : "";
            const proto = forwardedProto.length ? forwardedProto : "http";

            const redirectUri = `${proto}://${host}/auth/mcp-oauth/callback`;

            return context.mcpOauthService.startServerFlow({ ...input, redirectUri });
          }),
        waitForServerFlow: t
          .input(schemas.projects.mcpOauth.waitForServerFlow.input)
          .output(schemas.projects.mcpOauth.waitForServerFlow.output)
          .handler(async ({ context, input }) => {
            return context.mcpOauthService.waitForServerFlow(input.flowId, {
              timeoutMs: input.timeoutMs,
            });
          }),
        cancelServerFlow: t
          .input(schemas.projects.mcpOauth.cancelServerFlow.input)
          .output(schemas.projects.mcpOauth.cancelServerFlow.output)
          .handler(async ({ context, input }) => {
            await context.mcpOauthService.cancelServerFlow(input.flowId);
          }),
        getAuthStatus: t
          .input(schemas.projects.mcpOauth.getAuthStatus.input)
          .output(schemas.projects.mcpOauth.getAuthStatus.output)
          .handler(async ({ context, input }) => {
            const servers = await context.mcpConfigService.listServers(input.projectPath);
            const server = servers[input.serverName];

            if (!server || server.transport === "stdio") {
              return { isLoggedIn: false, hasRefreshToken: false };
            }

            return context.mcpOauthService.getAuthStatus({ serverUrl: server.url });
          }),
        logout: t
          .input(schemas.projects.mcpOauth.logout.input)
          .output(schemas.projects.mcpOauth.logout.output)
          .handler(async ({ context, input }) => {
            const servers = await context.mcpConfigService.listServers(input.projectPath);
            const server = servers[input.serverName];

            if (!server || server.transport === "stdio") {
              return Ok(undefined);
            }

            return context.mcpOauthService.logout({ serverUrl: server.url });
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
      crews: {
        list: t
          .input(schemas.projects.crews.list.input)
          .output(schemas.projects.crews.list.output)
          .handler(({ context, input }) => context.projectService.listCrews(input.projectPath)),
        create: t
          .input(schemas.projects.crews.create.input)
          .output(schemas.projects.crews.create.output)
          .handler(({ context, input }) =>
            context.projectService.createCrew(input.projectPath, input.name, input.color)
          ),
        update: t
          .input(schemas.projects.crews.update.input)
          .output(schemas.projects.crews.update.output)
          .handler(({ context, input }) =>
            context.projectService.updateCrew(input.projectPath, input.crewId, {
              name: input.name,
              color: input.color,
            })
          ),
        remove: t
          .input(schemas.projects.crews.remove.input)
          .output(schemas.projects.crews.remove.output)
          .handler(({ context, input }) =>
            context.projectService.removeCrew(input.projectPath, input.crewId)
          ),
        reorder: t
          .input(schemas.projects.crews.reorder.input)
          .output(schemas.projects.crews.reorder.output)
          .handler(({ context, input }) =>
            context.projectService.reorderCrews(input.projectPath, input.crewIds)
          ),
        assignMinion: t
          .input(schemas.projects.crews.assignMinion.input)
          .output(schemas.projects.crews.assignMinion.output)
          .handler(async ({ context, input }) => {
            const result = await context.projectService.assignMinionToCrew(
              input.projectPath,
              input.minionId,
              input.crewId
            );
            if (result.success) {
              // Emit metadata update so frontend receives the crewId change
              await context.minionService.refreshAndEmitMetadata(input.minionId);
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
          // Frontend provides ordered candidate list; resolved by createModel.
          // Backend tries candidates in order with retry on API errors.
          const result = await generateMinionIdentity(
            input.message,
            input.candidates,
            context.aiService
          );
          if (!result.success) {
            return result;
          }
          return {
            success: true,
            data: {
              name: result.data.name,
              title: result.data.title,
              modelUsed: result.data.modelUsed,
            },
          };
        }),
    },
    lattice: {
      getInfo: t
        .input(schemas.lattice.getInfo.input)
        .output(schemas.lattice.getInfo.output)
        .handler(async ({ context }) => {
          // Clear cache so each UI request gets a fresh check.
          // This ensures login/install status changes are picked up immediately.
          context.latticeService.clearCache();
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
      listMinions: t
        .input(schemas.lattice.listMinions.input)
        .output(schemas.lattice.listMinions.output)
        .handler(async ({ context }) => {
          return context.latticeService.listMinions();
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
    minion: {
      list: t
        .input(schemas.minion.list.input)
        .output(schemas.minion.list.output)
        .handler(async ({ context, input }) => {
          const allMinions = await context.minionService.list();
          // Filter by archived status (derived from timestamps via shared utility)
          if (input?.archived) {
            return allMinions.filter((w) => isMinionArchived(w.archivedAt, w.unarchivedAt));
          }
          // Default: return non-archived minions
          return allMinions.filter((w) => !isMinionArchived(w.archivedAt, w.unarchivedAt));
        }),
      create: t
        .input(schemas.minion.create.input)
        .output(schemas.minion.create.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.create(
            input.projectPath,
            input.branchName,
            input.trunkBranch,
            input.title,
            input.runtimeConfig,
            input.crewId
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, metadata: result.data.metadata };
        }),
      remove: t
        .input(schemas.minion.remove.input)
        .output(schemas.minion.remove.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.remove(
            input.minionId,
            input.options?.force
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true };
        }),
      updateAgentAISettings: t
        .input(schemas.minion.updateAgentAISettings.input)
        .output(schemas.minion.updateAgentAISettings.output)
        .handler(async ({ context, input }) => {
          return context.minionService.updateAgentAISettings(
            input.minionId,
            input.agentId,
            input.aiSettings
          );
        }),
      rename: t
        .input(schemas.minion.rename.input)
        .output(schemas.minion.rename.output)
        .handler(async ({ context, input }) => {
          return context.minionService.rename(input.minionId, input.newName);
        }),
      updateModeAISettings: t
        .input(schemas.minion.updateModeAISettings.input)
        .output(schemas.minion.updateModeAISettings.output)
        .handler(async ({ context, input }) => {
          return context.minionService.updateModeAISettings(
            input.minionId,
            input.mode,
            input.aiSettings
          );
        }),
      updateTitle: t
        .input(schemas.minion.updateTitle.input)
        .output(schemas.minion.updateTitle.output)
        .handler(async ({ context, input }) => {
          return context.minionService.updateTitle(input.minionId, input.title);
        }),
      regenerateTitle: t
        .input(schemas.minion.regenerateTitle.input)
        .output(schemas.minion.regenerateTitle.output)
        .handler(async ({ context, input }) => {
          return context.minionService.regenerateTitle(input.minionId);
        }),
      archive: t
        .input(schemas.minion.archive.input)
        .output(schemas.minion.archive.output)
        .handler(async ({ context, input }) => {
          return context.minionService.archive(input.minionId);
        }),
      unarchive: t
        .input(schemas.minion.unarchive.input)
        .output(schemas.minion.unarchive.output)
        .handler(async ({ context, input }) => {
          return context.minionService.unarchive(input.minionId);
        }),
      archiveMergedInProject: t
        .input(schemas.minion.archiveMergedInProject.input)
        .output(schemas.minion.archiveMergedInProject.output)
        .handler(async ({ context, input }) => {
          return context.minionService.archiveMergedInProject(input.projectPath);
        }),
      fork: t
        .input(schemas.minion.fork.input)
        .output(schemas.minion.fork.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.fork(
            input.sourceMinionId,
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
        .input(schemas.minion.sendMessage.input)
        .output(schemas.minion.sendMessage.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.sendMessage(
            input.minionId,
            input.message,
            input.options
          );

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return { success: true, data: {} };
        }),
      answerAskUserQuestion: t
        .input(schemas.minion.answerAskUserQuestion.input)
        .output(schemas.minion.answerAskUserQuestion.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.answerAskUserQuestion(
            input.minionId,
            input.toolCallId,
            input.answers
          );

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return { success: true, data: undefined };
        }),
      answerDelegatedToolCall: t
        .input(schemas.minion.answerDelegatedToolCall.input)
        .output(schemas.minion.answerDelegatedToolCall.output)
        .handler(({ context, input }) => {
          const result = context.minionService.answerDelegatedToolCall(
            input.minionId,
            input.toolCallId,
            input.result
          );

          if (!result.success) {
            return { success: false, error: result.error };
          }

          return { success: true, data: undefined };
        }),
      resumeStream: t
        .input(schemas.minion.resumeStream.input)
        .output(schemas.minion.resumeStream.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.resumeStream(
            input.minionId,
            input.options
          );
          if (!result.success) {
            const error =
              typeof result.error === "string"
                ? { type: "unknown" as const, raw: result.error }
                : result.error;
            return { success: false, error };
          }
          return { success: true, data: result.data };
        }),
      setAutoRetryEnabled: t
        .input(schemas.minion.setAutoRetryEnabled.input)
        .output(schemas.minion.setAutoRetryEnabled.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.setAutoRetryEnabled(
            input.minionId,
            input.enabled,
            input.persist ?? true
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        }),
      getStartupAutoRetryModel: t
        .input(schemas.minion.getStartupAutoRetryModel.input)
        .output(schemas.minion.getStartupAutoRetryModel.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.getStartupAutoRetryModel(input.minionId);
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        }),
      setAutoCompactionThreshold: t
        .input(schemas.minion.setAutoCompactionThreshold.input)
        .output(schemas.minion.setAutoCompactionThreshold.output)
        .handler(({ context, input }) => {
          const result = context.minionService.setAutoCompactionThreshold(
            input.minionId,
            input.threshold
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      interruptStream: t
        .input(schemas.minion.interruptStream.input)
        .output(schemas.minion.interruptStream.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.interruptStream(
            input.minionId,
            input.options
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      clearQueue: t
        .input(schemas.minion.clearQueue.input)
        .output(schemas.minion.clearQueue.output)
        .handler(({ context, input }) => {
          const result = context.minionService.clearQueue(input.minionId);
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      truncateHistory: t
        .input(schemas.minion.truncateHistory.input)
        .output(schemas.minion.truncateHistory.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.truncateHistory(
            input.minionId,
            input.percentage
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      replaceChatHistory: t
        .input(schemas.minion.replaceChatHistory.input)
        .output(schemas.minion.replaceChatHistory.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.replaceHistory(
            input.minionId,
            input.summaryMessage,
            { mode: input.mode, deletePlanFile: input.deletePlanFile }
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: undefined };
        }),
      getDevcontainerInfo: t
        .input(schemas.minion.getDevcontainerInfo.input)
        .output(schemas.minion.getDevcontainerInfo.output)
        .handler(async ({ context, input }) => {
          return context.minionService.getDevcontainerInfo(input.minionId);
        }),
      getInfo: t
        .input(schemas.minion.getInfo.input)
        .output(schemas.minion.getInfo.output)
        .handler(async ({ context, input }) => {
          return context.minionService.getInfo(input.minionId);
        }),
      getLastLlmRequest: t
        .input(schemas.minion.getLastLlmRequest.input)
        .output(schemas.minion.getLastLlmRequest.output)
        .handler(({ context, input }) => {
          return context.aiService.debugGetLastLlmRequest(input.minionId);
        }),
      getFullReplay: t
        .input(schemas.minion.getFullReplay.input)
        .output(schemas.minion.getFullReplay.output)
        .handler(async ({ context, input }) => {
          return context.minionService.getFullReplay(input.minionId);
        }),
      getSidekickTranscript: t
        .input(schemas.minion.getSidekickTranscript.input)
        .output(schemas.minion.getSidekickTranscript.output)
        .handler(async ({ context, input }) => {
          const taskId = input.taskId.trim();
          assert(taskId.length > 0, "minion.getSidekickTranscript: taskId must be non-empty");

          const requestingMinionIdTrimmed = input.minionId?.trim();
          const requestingMinionId =
            requestingMinionIdTrimmed && requestingMinionIdTrimmed.length > 0
              ? requestingMinionIdTrimmed
              : null;

          const tryLoadFromMinion = async (
            minionId: string
          ): Promise<{
            minionId: string;
            entry: SidekickTranscriptArtifactIndexEntry;
          } | null> => {
            const sessionDir = context.config.getSessionDir(minionId);
            const artifacts = await readSidekickTranscriptArtifactsFile(sessionDir);
            const entry = artifacts.artifactsByChildTaskId[taskId] ?? null;
            return entry ? { minionId, entry } : null;
          };

          const tryLoadFromDescendantMinions = async (
            ancestorMinionId: string
          ): Promise<{
            minionId: string;
            entry: SidekickTranscriptArtifactIndexEntry;
          } | null> => {
            // If a grandchild task has already been cleaned up, its transcript is archived into the
            // immediate parent minion's session dir. Until that parent minion is cleaned up and
            // its artifacts are rolled up, the requesting minion won't have the transcript index.
            const descendants = context.taskService.listDescendantAgentTasks(ancestorMinionId);

            // Prefer shallower tasks first so we find the owning parent quickly.
            descendants.sort((a, b) => a.depth - b.depth);

            for (const descendant of descendants) {
              const loaded = await tryLoadFromMinion(descendant.taskId);
              if (loaded) return loaded;
            }

            return null;
          };

          // Auth: allow if the task is a descendant OR if we have an on-disk transcript artifact entry.
          // The descendant check is best-effort: if it throws (corrupt config), we fall back to the
          // artifact existence check to keep the UI usable.
          let isDescendant = false;
          if (requestingMinionId) {
            try {
              isDescendant = await context.taskService.isDescendantAgentTask(
                requestingMinionId,
                taskId
              );
            } catch (error: unknown) {
              log.warn("minion.getSidekickTranscript: descendant check failed", {
                requestingMinionId,
                taskId,
                error: getErrorMessage(error),
              });
            }
          }

          const readTranscriptFromPaths = async (params: {
            minionId: string;
            chatPath?: string;
            partialPath?: string;
            logLabel: string;
          }): Promise<LatticeMessage[]> => {
            const minionSessionDir = context.config.getSessionDir(params.minionId);

            // Defense-in-depth: refuse path traversal from a corrupted index file.
            if (params.chatPath && !isPathInsideDir(minionSessionDir, params.chatPath)) {
              throw new Error("Refusing to read transcript outside minion session dir");
            }
            if (params.partialPath && !isPathInsideDir(minionSessionDir, params.partialPath)) {
              throw new Error("Refusing to read partial outside minion session dir");
            }

            const partial = params.partialPath
              ? await readPartialJsonBestEffort(params.partialPath)
              : null;
            const messages = params.chatPath
              ? await readChatJsonlAllowMissing({
                  chatPath: params.chatPath,
                  logLabel: params.logLabel,
                })
              : null;

            // If we only archived partial.json (e.g. interrupted stream), still allow viewing.
            if (!messages && !partial) {
              throw new Error(`Transcript not found (missing ${params.logLabel})`);
            }

            return mergePartialIntoHistory(messages ?? [], partial);
          };

          let resolved: {
            minionId: string;
            entry: SidekickTranscriptArtifactIndexEntry;
          } | null = null;
          let hasArtifactInRequestingTree = false;

          if (requestingMinionId !== null) {
            resolved = await tryLoadFromMinion(requestingMinionId);
            if (resolved) {
              hasArtifactInRequestingTree = true;
            } else {
              resolved = await tryLoadFromDescendantMinions(requestingMinionId);
              hasArtifactInRequestingTree = resolved !== null;
            }
          } else {
            resolved = await findSidekickTranscriptEntryByScanningSessions({
              sessionsDir: context.config.sessionsDir,
              taskId,
            });
          }

          // If the transcript hasn't been archived yet (common while patch artifacts are pending),
          // fall back to reading from the task's live session dir while it still exists.
          if (!resolved) {
            if (requestingMinionId && isDescendant) {
              const taskSessionDir = context.config.getSessionDir(taskId);
              const messages = await readTranscriptFromPaths({
                minionId: taskId,
                chatPath: path.join(taskSessionDir, "chat.jsonl"),
                partialPath: path.join(taskSessionDir, "partial.json"),
                logLabel: `${taskId}/chat.jsonl`,
              });

              const metaResult = await context.aiService.getMinionMetadata(taskId);
              const model =
                metaResult.success &&
                typeof metaResult.data.taskModelString === "string" &&
                metaResult.data.taskModelString.trim().length > 0
                  ? metaResult.data.taskModelString.trim()
                  : undefined;
              const thinkingLevel = metaResult.success
                ? coerceThinkingLevel(metaResult.data.taskThinkingLevel)
                : undefined;

              return { messages, model, thinkingLevel };
            }

            // Helpful error message for UI.
            throw new Error(
              requestingMinionId
                ? `No transcript found for task ${taskId} in minion ${requestingMinionId}`
                : `No transcript found for task ${taskId}`
            );
          }

          if (requestingMinionId && !isDescendant && !hasArtifactInRequestingTree) {
            throw new Error("Task is not a descendant of this minion");
          }

          const messages = await readTranscriptFromPaths({
            minionId: resolved.minionId,
            chatPath: resolved.entry.chatPath,
            partialPath: resolved.entry.partialPath,
            logLabel: `${resolved.minionId}/sidekick-transcripts/${taskId}/chat.jsonl`,
          });

          const model =
            typeof resolved.entry.model === "string" && resolved.entry.model.trim().length > 0
              ? resolved.entry.model.trim()
              : undefined;
          const thinkingLevel = coerceThinkingLevel(resolved.entry.thinkingLevel);

          return { messages, model, thinkingLevel };
        }),
      executeBash: t
        .input(schemas.minion.executeBash.input)
        .output(schemas.minion.executeBash.output)
        .handler(async ({ context, input }) => {
          const result = await context.minionService.executeBash(
            input.minionId,
            input.script,
            input.options
          );
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        }),
      getFileCompletions: t
        .input(schemas.minion.getFileCompletions.input)
        .output(schemas.minion.getFileCompletions.output)
        .handler(async ({ context, input }) => {
          return context.minionService.getFileCompletions(
            input.minionId,
            input.query,
            input.limit
          );
        }),
      onChat: t
        .input(schemas.minion.onChat.input)
        .output(schemas.minion.onChat.output)
        .handler(async function* ({ context, input, signal }) {
          const session = context.minionService.getOrCreateSession(input.minionId);
          if (typeof input.legacyAutoRetryEnabled === "boolean") {
            session.setLegacyAutoRetryEnabledHint(input.legacyAutoRetryEnabled);
          }

          const { push, iterate, end } = createAsyncMessageQueue<MinionChatMessage>();

          const onAbort = () => {
            // Ensure we tear down the async generator even if the client stops iterating without
            // calling iterator.return(). This prevents orphaned heartbeat intervals.
            end();
          };

          if (signal) {
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }

          // 1. Subscribe to new events (including those triggered by replay)
          //
          // IMPORTANT: We subscribe before replay so we can receive stream replay (`replayStream()`)
          // and init replay events (which do not set `replay: true`).
          //
          // Live stream deltas can overlap with replayed deltas on reconnect. Buffer live stream
          // events during replay and flush after `caught-up`, skipping any deltas already delivered
          // by replay.
          const replayRelay = createReplayBufferedStreamMessageRelay(push);

          const unsubscribe = session.onChatEvent(({ message }) => {
            replayRelay.handleSessionMessage(message);
          });

          // 2. Replay history (sends caught-up at the end)
          await session.replayHistory(({ message }) => {
            push(message);
          }, input.mode);

          replayRelay.finishReplay();

          // Startup recovery: after replay catches the client up, recover any
          // crash-stranded compaction follow-ups and then evaluate auto-retry.
          session.scheduleStartupRecovery();

          // 3. Heartbeat to keep the connection alive during long operations (tool calls, sidekicks).
          // Client uses this to detect stalled connections vs. intentionally idle streams.
          const HEARTBEAT_INTERVAL_MS = 5_000;
          const heartbeatInterval = setInterval(() => {
            push({ type: "heartbeat" });
          }, HEARTBEAT_INTERVAL_MS);

          try {
            yield* iterate();
          } finally {
            clearInterval(heartbeatInterval);
            signal?.removeEventListener("abort", onAbort);
            end();
            unsubscribe();
          }
        }),
      onMetadata: t
        .input(schemas.minion.onMetadata.input)
        .output(schemas.minion.onMetadata.output)
        .handler(async function* ({ context, signal }) {
          const service = context.minionService;

          interface MetadataEvent {
            minionId: string;
            metadata: FrontendMinionMetadataSchemaType | null;
          }

          let resolveNext: ((value: MetadataEvent | null) => void) | null = null;
          const queue: MetadataEvent[] = [];
          let ended = false;

          const push = (event: MetadataEvent) => {
            if (ended) return;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(event);
            } else {
              queue.push(event);
            }
          };

          const onMetadata = (event: MetadataEvent) => {
            push(event);
          };

          service.on("metadata", onMetadata);

          const onAbort = () => {
            if (ended) return;
            ended = true;

            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(null);
            }
          };

          if (signal) {
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }

          try {
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
                continue;
              }

              const event = await new Promise<MetadataEvent | null>((resolve) => {
                resolveNext = resolve;
              });

              if (event === null || ended) {
                break;
              }

              yield event;
            }
          } finally {
            ended = true;
            signal?.removeEventListener("abort", onAbort);
            service.off("metadata", onMetadata);
          }
        }),
      activity: {
        list: t
          .input(schemas.minion.activity.list.input)
          .output(schemas.minion.activity.list.output)
          .handler(async ({ context }) => {
            return context.minionService.getActivityList();
          }),
        subscribe: t
          .input(schemas.minion.activity.subscribe.input)
          .output(schemas.minion.activity.subscribe.output)
          .handler(async function* ({ context, signal }) {
            const service = context.minionService;

            interface ActivityEvent {
              minionId: string;
              activity: MinionActivitySnapshot | null;
            }

            let resolveNext: ((value: ActivityEvent | null) => void) | null = null;
            const queue: ActivityEvent[] = [];
            let ended = false;

            const push = (event: ActivityEvent) => {
              if (ended) return;
              if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                resolve(event);
              } else {
                queue.push(event);
              }
            };

            const onActivity = (event: ActivityEvent) => {
              push(event);
            };

            service.on("activity", onActivity);

            const onAbort = () => {
              if (ended) return;
              ended = true;

              if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                resolve(null);
              }
            };

            if (signal) {
              if (signal.aborted) {
                onAbort();
              } else {
                signal.addEventListener("abort", onAbort, { once: true });
              }
            }

            try {
              while (!ended) {
                if (queue.length > 0) {
                  yield queue.shift()!;
                  continue;
                }

                const event = await new Promise<ActivityEvent | null>((resolve) => {
                  resolveNext = resolve;
                });

                if (event === null || ended) {
                  break;
                }

                yield event;
              }
            } finally {
              ended = true;
              signal?.removeEventListener("abort", onAbort);
              service.off("activity", onActivity);
            }
          }),
      },
      history: {
        loadMore: t
          .input(schemas.minion.history.loadMore.input)
          .output(schemas.minion.history.loadMore.output)
          .handler(async ({ context, input }) => {
            return context.minionService.getHistoryLoadMore(input.minionId, input.cursor);
          }),
      },
      getPlanContent: t
        .input(schemas.minion.getPlanContent.input)
        .output(schemas.minion.getPlanContent.output)
        .handler(async ({ context, input }) => {
          // Get minion metadata to determine runtime and paths
          const metadata = await context.minionService.getInfo(input.minionId);
          if (!metadata) {
            return { success: false as const, error: `Minion not found: ${input.minionId}` };
          }

          // Create runtime to read plan file (supports both local and SSH)
          const runtime = createRuntimeForMinion(metadata);

          const result = await readPlanFile(
            runtime,
            metadata.name,
            metadata.projectName,
            input.minionId
          );

          if (!result.exists) {
            return { success: false as const, error: `Plan file not found at ${result.path}` };
          }
          return { success: true as const, data: { content: result.content, path: result.path } };
        }),
      backgroundBashes: {
        subscribe: t
          .input(schemas.minion.backgroundBashes.subscribe.input)
          .output(schemas.minion.backgroundBashes.subscribe.output)
          .handler(async function* ({ context, input, signal }) {
            const service = context.minionService;
            const { minionId } = input;

            if (signal?.aborted) {
              return;
            }

            const getState = async () => ({
              processes: await service.listBackgroundProcesses(minionId),
              foregroundToolCallIds: service.getForegroundToolCallIds(minionId),
            });

            const queue = createAsyncEventQueue<Awaited<ReturnType<typeof getState>>>();

            const onAbort = () => {
              queue.end();
            };

            if (signal) {
              signal.addEventListener("abort", onAbort, { once: true });
            }

            const onChange = (changedMinionId: string) => {
              if (changedMinionId === minionId) {
                void getState().then(queue.push);
              }
            };

            service.onBackgroundBashChange(onChange);

            try {
              // Emit initial state immediately
              yield await getState();
              yield* queue.iterate();
            } finally {
              signal?.removeEventListener("abort", onAbort);
              queue.end();
              service.offBackgroundBashChange(onChange);
            }
          }),
        terminate: t
          .input(schemas.minion.backgroundBashes.terminate.input)
          .output(schemas.minion.backgroundBashes.terminate.output)
          .handler(async ({ context, input }) => {
            const result = await context.minionService.terminateBackgroundProcess(
              input.minionId,
              input.processId
            );
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return { success: true, data: undefined };
          }),
        sendToBackground: t
          .input(schemas.minion.backgroundBashes.sendToBackground.input)
          .output(schemas.minion.backgroundBashes.sendToBackground.output)
          .handler(({ context, input }) => {
            const result = context.minionService.sendToBackground(input.toolCallId);
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return { success: true, data: undefined };
          }),
        getOutput: t
          .input(schemas.minion.backgroundBashes.getOutput.input)
          .output(schemas.minion.backgroundBashes.getOutput.output)
          .handler(async ({ context, input }) => {
            const result = await context.minionService.getBackgroundProcessOutput(
              input.minionId,
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
        .input(schemas.minion.getPostCompactionState.input)
        .output(schemas.minion.getPostCompactionState.output)
        .handler(({ context, input }) => {
          return context.minionService.getPostCompactionState(input.minionId);
        }),
      setPostCompactionExclusion: t
        .input(schemas.minion.setPostCompactionExclusion.input)
        .output(schemas.minion.setPostCompactionExclusion.output)
        .handler(async ({ context, input }) => {
          return context.minionService.setPostCompactionExclusion(
            input.minionId,
            input.itemId,
            input.excluded
          );
        }),
      getSessionUsage: t
        .input(schemas.minion.getSessionUsage.input)
        .output(schemas.minion.getSessionUsage.output)
        .handler(async ({ context, input }) => {
          return context.sessionUsageService.getSessionUsage(input.minionId);
        }),
      getSessionUsageBatch: t
        .input(schemas.minion.getSessionUsageBatch.input)
        .output(schemas.minion.getSessionUsageBatch.output)
        .handler(async ({ context, input }) => {
          return context.sessionUsageService.getSessionUsageBatch(input.minionIds);
        }),
      stats: {
        subscribe: t
          .input(schemas.minion.stats.subscribe.input)
          .output(schemas.minion.stats.subscribe.output)
          .handler(async function* ({ context, input, signal }) {
            const minionId = input.minionId;

            if (signal?.aborted) {
              return;
            }

            context.sessionTimingService.addSubscriber(minionId);

            const queue = (() => {
              // Coalesce snapshots: keep only the most recent snapshot to avoid an
              // unbounded queue under high-frequency stream deltas.
              let buffered: MinionStatsSnapshot | undefined;
              let hasBuffered = false;
              let resolveNext: ((value: MinionStatsSnapshot | null) => void) | null = null;
              let ended = false;

              const push = (value: MinionStatsSnapshot) => {
                if (ended) return;

                if (resolveNext) {
                  const resolve = resolveNext;
                  resolveNext = null;
                  resolve(value);
                  return;
                }

                buffered = value;
                hasBuffered = true;
              };

              async function* iterate(): AsyncGenerator<MinionStatsSnapshot> {
                while (true) {
                  if (ended) {
                    return;
                  }

                  if (hasBuffered) {
                    const value = buffered;
                    buffered = undefined;
                    hasBuffered = false;
                    if (value !== undefined) {
                      yield value;
                    }
                    continue;
                  }

                  const next = await new Promise<MinionStatsSnapshot | null>((resolve) => {
                    resolveNext = resolve;
                  });

                  if (ended || next === null) {
                    return;
                  }

                  yield next;
                }
              }

              const end = () => {
                ended = true;
                if (resolveNext) {
                  const resolve = resolveNext;
                  resolveNext = null;
                  resolve(null);
                }
              };

              return { push, iterate, end };
            })();

            // Snapshot computation is async; without coalescing, we can build an unbounded
            // backlog when token deltas arrive quickly.
            const SNAPSHOT_THROTTLE_MS = 100;

            let lastPushedAtMs = 0;
            let inFlight = false;
            let pendingTimer: ReturnType<typeof setTimeout> | undefined;
            let pendingSnapshot = false;
            let closed = false;

            const onAbort = () => {
              closed = true;

              if (pendingTimer) {
                clearTimeout(pendingTimer);
                pendingTimer = undefined;
              }

              queue.end();
            };

            if (signal) {
              signal.addEventListener("abort", onAbort, { once: true });
            }

            const pushSnapshot = async () => {
              if (closed) return;
              if (inFlight) return;
              if (!pendingSnapshot) return;

              pendingSnapshot = false;
              inFlight = true;

              try {
                const snapshot = await context.sessionTimingService.getSnapshot(minionId);
                if (closed) return;

                lastPushedAtMs = snapshot.generatedAt;
                queue.push(snapshot);
              } finally {
                inFlight = false;

                if (!closed && pendingSnapshot) {
                  scheduleSnapshot();
                }
              }
            };

            const runPushSnapshot = () => {
              void pushSnapshot().catch(() => {
                // Defensive: a failed snapshot fetch should never brick the subscription.
              });
            };

            const scheduleSnapshot = () => {
              pendingSnapshot = true;

              if (closed) {
                return;
              }

              if (inFlight) {
                return;
              }

              if (pendingTimer) {
                return;
              }

              const now = Date.now();
              const timeSinceLastPush = now - lastPushedAtMs;

              if (timeSinceLastPush >= SNAPSHOT_THROTTLE_MS) {
                runPushSnapshot();
                return;
              }

              const remaining = SNAPSHOT_THROTTLE_MS - timeSinceLastPush;
              pendingTimer = setTimeout(() => {
                pendingTimer = undefined;
                runPushSnapshot();
              }, remaining);

              // Avoid keeping Node (or Jest workers) alive due to a leaked throttle timer.
              pendingTimer.unref?.();
            };

            const onChange = (changedMinionId: string) => {
              if (changedMinionId !== minionId) {
                return;
              }
              scheduleSnapshot();
            };

            // Subscribe before awaiting the initial snapshot so we don't miss a
            // stats-change event that happens while getSnapshot() is in-flight.
            //
            // Treat the initial snapshot fetch as inFlight to prevent scheduleSnapshot()
            // from starting a concurrent fetch that could push a newer snapshot before
            // the initial one.
            inFlight = true;
            context.sessionTimingService.onStatsChange(onChange);

            try {
              const initial = await context.sessionTimingService.getSnapshot(minionId);
              lastPushedAtMs = initial.generatedAt;
              queue.push(initial);
            } finally {
              inFlight = false;

              if (!closed && pendingSnapshot) {
                scheduleSnapshot();
              }
            }

            try {
              yield* queue.iterate();
            } finally {
              closed = true;
              signal?.removeEventListener("abort", onAbort);
              if (pendingTimer) {
                clearTimeout(pendingTimer);
              }

              queue.end();
              context.sessionTimingService.offStatsChange(onChange);
              context.sessionTimingService.removeSubscriber(minionId);
            }
          }),
        clear: t
          .input(schemas.minion.stats.clear.input)
          .output(schemas.minion.stats.clear.output)
          .handler(async ({ context, input }) => {
            try {
              await context.sessionTimingService.clearTimingFile(input.minionId);
              return { success: true, data: undefined };
            } catch (error) {
              const message = getErrorMessage(error);
              return { success: false, error: message };
            }
          }),
      },
      mcp: {
        get: t
          .input(schemas.minion.mcp.get.input)
          .output(schemas.minion.mcp.get.output)
          .handler(async ({ context, input }) => {
            const policy = context.policyService.getEffectivePolicy();
            const mcpDisabledByPolicy =
              context.policyService.isEnforced() &&
              policy?.mcp.allowUserDefined.stdio === false &&
              policy.mcp.allowUserDefined.remote === false;

            if (mcpDisabledByPolicy) {
              return {};
            }

            try {
              return await context.minionMcpOverridesService.getOverridesForMinion(
                input.minionId
              );
            } catch {
              // Defensive: overrides must never brick minion UI.
              return {};
            }
          }),
        set: t
          .input(schemas.minion.mcp.set.input)
          .output(schemas.minion.mcp.set.output)
          .handler(async ({ context, input }) => {
            try {
              await context.minionMcpOverridesService.setOverridesForMinion(
                input.minionId,
                input.overrides
              );
              return { success: true, data: undefined };
            } catch (error) {
              const message = getErrorMessage(error);
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
            parentMinionId: input.parentMinionId,
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
        .handler(async function* ({ context, input, signal }) {
          if (signal?.aborted) {
            return;
          }

          let resolveNext: ((value: string | null) => void) | null = null;
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

          const onAbort = () => {
            if (ended) return;
            ended = true;

            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(null);
            }
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
                continue;
              }

              const data = await new Promise<string | null>((resolve) => {
                resolveNext = resolve;
              });

              if (data === null || ended) {
                break;
              }

              yield data;
            }
          } finally {
            ended = true;
            signal?.removeEventListener("abort", onAbort);
            unsubscribe();
          }
        }),
      attach: t
        .input(schemas.terminal.attach.input)
        .output(schemas.terminal.attach.output)
        .handler(async function* ({ context, input, signal }) {
          if (signal?.aborted) {
            return;
          }

          type AttachMessage =
            | { type: "screenState"; data: string }
            | { type: "output"; data: string };

          let resolveNext: ((value: AttachMessage | null) => void) | null = null;
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

          const onAbort = () => {
            if (ended) return;
            ended = true;

            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(null);
            }
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            // Capture screen state AFTER subscription is set up - guarantees no missed output
            const screenState = context.terminalService.getScreenState(input.sessionId);

            // First message is always the screen state (may be empty for new sessions)
            yield { type: "screenState" as const, data: screenState };

            // Now yield any queued output and continue with live stream
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
                continue;
              }

              const msg = await new Promise<AttachMessage | null>((resolve) => {
                resolveNext = resolve;
              });

              if (msg === null || ended) {
                break;
              }

              yield msg;
            }
          } finally {
            ended = true;
            signal?.removeEventListener("abort", onAbort);
            unsubscribe();
          }
        }),
      onExit: t
        .input(schemas.terminal.onExit.input)
        .output(schemas.terminal.onExit.output)
        .handler(async function* ({ context, input, signal }) {
          if (signal?.aborted) {
            return;
          }

          let resolveNext: ((value: number | null) => void) | null = null;
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

          const onAbort = () => {
            if (ended) return;
            ended = true;

            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve(null);
            }
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            while (!ended) {
              if (queue.length > 0) {
                yield queue.shift()!;
                // Terminal only exits once, so we can finish the stream
                break;
              }

              const code = await new Promise<number | null>((resolve) => {
                resolveNext = resolve;
              });

              if (code === null || ended) {
                break;
              }

              yield code;
              break;
            }
          } finally {
            ended = true;
            signal?.removeEventListener("abort", onAbort);
            unsubscribe();
          }
        }),
      openWindow: t
        .input(schemas.terminal.openWindow.input)
        .output(schemas.terminal.openWindow.output)
        .handler(async ({ context, input }) => {
          return context.terminalService.openWindow(input.minionId, input.sessionId);
        }),
      closeWindow: t
        .input(schemas.terminal.closeWindow.input)
        .output(schemas.terminal.closeWindow.output)
        .handler(({ context, input }) => {
          return context.terminalService.closeWindow(input.minionId);
        }),
      listSessions: t
        .input(schemas.terminal.listSessions.input)
        .output(schemas.terminal.listSessions.output)
        .handler(async ({ context, input }) => {
          return context.terminalService.getMinionSessionIds(input.minionId);
        }),
      openNative: t
        .input(schemas.terminal.openNative.input)
        .output(schemas.terminal.openNative.output)
        .handler(async ({ context, input }) => {
          return context.terminalService.openNative(input.minionId);
        }),
      activity: {
        subscribe: t
          .input(schemas.terminal.activity.subscribe.input)
          .output(schemas.terminal.activity.subscribe.output)
          .handler(async function* ({ context, signal }) {
            if (signal?.aborted) {
              return;
            }

            const queue = createAsyncEventQueue<{
              type: "update";
              minionId: string;
              activity: { activeCount: number; totalSessions: number };
            }>();

            const unsubscribe = context.terminalService.onActivityChange((minionId: string) => {
              queue.push({
                type: "update" as const,
                minionId,
                activity: context.terminalService.getMinionActivity(minionId),
              });
            });

            const onAbort = () => {
              queue.end();
            };

            if (signal) {
              signal.addEventListener("abort", onAbort, { once: true });
            }

            try {
              // Yield initial snapshot (listener registered before snapshot, so no transition lost)
              yield {
                type: "snapshot" as const,
                minions: context.terminalService.getAllMinionActivity(),
              };

              yield* queue.iterate();
            } finally {
              signal?.removeEventListener("abort", onAbort);
              queue.end();
              unsubscribe();
            }
          }),
      },
    },

    // Terminal Profiles — CLI tool detection, install recipes, user config
    terminalProfiles: {
      list: t
        .input(schemas.terminalProfiles.list.input)
        .output(schemas.terminalProfiles.list.output)
        .handler(async ({ context }) => {
          const service = new TerminalProfileService(context.config);
          return service.listWithStatus();
        }),
      setConfig: t
        .input(schemas.terminalProfiles.setConfig.input)
        .output(schemas.terminalProfiles.setConfig.output)
        .handler(async ({ context, input }) => {
          await context.config.editConfig((cfg) => {
            const profiles = cfg.terminalProfiles ?? {};
            profiles[input.profileId] = input.config;
            cfg.terminalProfiles = profiles;
            return cfg;
          });
        }),
      getInstallRecipe: t
        .input(schemas.terminalProfiles.getInstallRecipe.input)
        .output(schemas.terminalProfiles.getInstallRecipe.output)
        .handler(({ input }) => {
          const definition = TERMINAL_PROFILE_DEFINITIONS[input.profileId];
          if (!definition) return [];
          const recipes = definition.install;
          switch (input.runtimeType) {
            case "local":
            case "worktree":
              return recipes.local ?? [];
            case "ssh":
              return recipes.ssh ?? recipes.local ?? [];
            case "docker":
            case "devcontainer":
              return recipes.docker ?? recipes.local ?? [];
            default:
              return recipes.local ?? [];
          }
        }),
    },

    // Kanban — terminal session lifecycle tracking board
    kanban: {
      list: t
        .input(schemas.kanban.list.input)
        .output(schemas.kanban.list.output)
        .handler(async ({ context, input }) => {
          // Bidirectional sync: remove stale active cards for dead sessions AND
          // create missing cards for live sessions not yet tracked by kanban.
          const liveSessions = context.terminalService.getLiveSessions(input.minionId);
          await context.kanbanService.syncWithLiveSessions(input.minionId, liveSessions);
          return context.kanbanService.getCards(input.minionId);
        }),
      moveCard: t
        .input(schemas.kanban.moveCard.input)
        .output(schemas.kanban.moveCard.output)
        .handler(async ({ context, input }) => {
          await context.kanbanService.moveCard(
            input.minionId,
            input.sessionId,
            input.targetColumn
          );
        }),
      subscribe: t
        .input(schemas.kanban.subscribe.input)
        .output(schemas.kanban.subscribe.output)
        .handler(async function* ({ context, input, signal }) {
          if (signal?.aborted) {
            return;
          }

          const queue = createAsyncEventQueue<Awaited<ReturnType<typeof getCards>>>();

          async function getCards() {
            // Bidirectional sync before every snapshot — keeps board in lockstep
            // with live PTY sessions (removes stale, adds missing).
            const liveSessions = context.terminalService.getLiveSessions(input.minionId);
            await context.kanbanService.syncWithLiveSessions(input.minionId, liveSessions);
            return context.kanbanService.getCards(input.minionId);
          }

          // Yield initial snapshot
          queue.push(await getCards());

          // Subscribe to changes and re-yield full state
          const unsubscribe = context.kanbanService.onChange((minionId) => {
            if (minionId === input.minionId) {
              void getCards().then((cards) => queue.push(cards));
            }
          });

          const onAbort = () => {
            queue.end();
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            queue.end();
            unsubscribe();
          }
        }),
      getArchivedBuffer: t
        .input(schemas.kanban.getArchivedBuffer.input)
        .output(schemas.kanban.getArchivedBuffer.output)
        .handler(async ({ context, input }) => {
          const buffer = await context.kanbanService.getArchivedBuffer(
            input.minionId,
            input.sessionId
          );
          return { screenBuffer: buffer };
        }),
    },

    // Inbox — channel adapters (Telegram, Slack, etc.)
    inbox: {
      list: t
        .input(schemas.inbox.list.input)
        .output(schemas.inbox.list.output)
        .handler(async ({ context, input }) => {
          const conversations = await context.inboxService.getConversations(
            input.projectPath,
            input.channel
          );
          // Strip messages from list response (fetched separately via getConversation)
          return conversations.map(({ messages: _, ...rest }) => rest);
        }),
      getConversation: t
        .input(schemas.inbox.getConversation.input)
        .output(schemas.inbox.getConversation.output)
        .handler(async ({ context, input }) => {
          const convo = await context.inboxService.getConversation(
            input.projectPath,
            input.sessionKey
          );
          if (!convo) {
            throw new Error("Conversation not found");
          }
          return convo;
        }),
      updateStatus: t
        .input(schemas.inbox.updateStatus.input)
        .output(schemas.inbox.updateStatus.output)
        .handler(async ({ context, input }) => {
          await context.inboxService.updateStatus(
            input.projectPath,
            input.sessionKey,
            input.status
          );
        }),
      sendReply: t
        .input(schemas.inbox.sendReply.input)
        .output(schemas.inbox.sendReply.output)
        .handler(async ({ context, input }) => {
          await context.inboxService.sendReply(input.projectPath, input.sessionKey, input.message);
        }),
      subscribe: t
        .input(schemas.inbox.subscribe.input)
        .output(schemas.inbox.subscribe.output)
        .handler(async function* ({ context, input, signal }) {
          if (signal?.aborted) return;

          type ConvoSummary = Awaited<ReturnType<typeof getConversations>>;
          const queue = createAsyncEventQueue<ConvoSummary>();

          async function getConversations() {
            const conversations = await context.inboxService.getConversations(input.projectPath);
            return conversations.map(({ messages: _, ...rest }) => rest);
          }

          // Yield initial snapshot
          queue.push(await getConversations());

          // Subscribe to changes and re-yield
          const unsubscribe = context.inboxService.onChange(() => {
            void getConversations().then((snapshot) => queue.push(snapshot));
          });

          const onAbort = () => queue.end();
          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            queue.end();
            unsubscribe();
          }
        }),
      connectionStatus: t
        .input(schemas.inbox.connectionStatus.input)
        .output(schemas.inbox.connectionStatus.output)
        .handler(({ context }) => {
          return { adapters: context.inboxService.getConnectionStatus() };
        }),
      connectAdapter: t
        .input(schemas.inbox.connectAdapter.input)
        .output(schemas.inbox.connectAdapter.output)
        .handler(async ({ context, input }) => {
          await context.inboxService.connectAdapter(input.channel);
        }),
      disconnectAdapter: t
        .input(schemas.inbox.disconnectAdapter.input)
        .output(schemas.inbox.disconnectAdapter.output)
        .handler(async ({ context, input }) => {
          await context.inboxService.disconnectAdapter(input.channel);
        }),
      setChannelToken: t
        .input(schemas.inbox.setChannelToken.input)
        .output(schemas.inbox.setChannelToken.output)
        .handler(async ({ context, input }) => {
          // Persist the token to config
          if (input.channel === "telegram") {
            await context.config.setTelegramBotToken(input.token ?? null);
          }
          // If clearing token, disconnect and unregister the adapter
          if (input.token == null) {
            await context.inboxService.disconnectAdapter(input.channel);
            return;
          }
          // Register a new adapter with the updated token and connect it
          if (input.channel === "telegram") {
            context.inboxService.registerAdapter(new TelegramAdapter(input.token));
            await context.inboxService.connectAdapter(input.channel);
          }
        }),
      getChannelTokens: t
        .input(schemas.inbox.getChannelTokens.input)
        .output(schemas.inbox.getChannelTokens.output)
        .handler(({ context }) => {
          // Currently only Telegram is supported; extend as more adapters are added
          const telegramToken = context.config.getTelegramBotToken();
          return [
            {
              channel: "telegram" as const,
              configured: telegramToken != null,
              maskedToken: telegramToken ? `${telegramToken.slice(0, 6)}...` : null,
            },
          ];
        }),
    },

    // Inference — exo distributed inference cluster
    inference: {
      getStatus: t
        .input(schemas.inference.getStatus.input)
        .output(schemas.inference.getStatus.output)
        .handler(async ({ context }) => {
          return context.exoService.getState();
        }),
      subscribe: t
        .input(schemas.inference.subscribe.input)
        .output(schemas.inference.subscribe.output)
        .handler(async function* ({ context, signal }) {
          if (signal?.aborted) return;

          const queue =
            createAsyncEventQueue<Awaited<ReturnType<typeof context.exoService.getState>>>();

          // Yield initial state
          queue.push(await context.exoService.getState());

          // Start polling and subscribe to changes
          context.exoService.startPolling();
          const unsubscribe = context.exoService.onChange(() => {
            void context.exoService.getState().then((state) => queue.push(state));
          });

          const onAbort = () => queue.end();
          if (signal) signal.addEventListener("abort", onAbort, { once: true });

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            queue.end();
            unsubscribe();
            context.exoService.stopPolling();
          }
        }),
    },

    // Scheduler — cron/interval job scheduling for automated agent tasks
    scheduler: {
      list: t
        .input(schemas.scheduler.list.input)
        .output(schemas.scheduler.list.output)
        .handler(({ context, input }) => {
          return context.schedulerService.list(input.projectPath);
        }),
      create: t
        .input(schemas.scheduler.create.input)
        .output(schemas.scheduler.create.output)
        .handler(async ({ context, input }) => {
          return context.schedulerService.create(input.projectPath, {
            name: input.name,
            minionId: input.minionId,
            prompt: input.prompt,
            model: input.model,
            schedule: input.schedule,
            enabled: input.enabled,
          });
        }),
      update: t
        .input(schemas.scheduler.update.input)
        .output(schemas.scheduler.update.output)
        .handler(async ({ context, input }) => {
          const patch: Record<string, unknown> = {};
          if (input.name != null) patch.name = input.name;
          if (input.minionId != null) patch.minionId = input.minionId;
          if (input.prompt != null) patch.prompt = input.prompt;
          // model uses !== undefined: null means "clear override", undefined means "no change"
          if (input.model !== undefined) patch.model = input.model;
          if (input.schedule != null) patch.schedule = input.schedule;
          if (input.enabled != null) patch.enabled = input.enabled;
          return context.schedulerService.update(input.id, patch);
        }),
      remove: t
        .input(schemas.scheduler.remove.input)
        .output(schemas.scheduler.remove.output)
        .handler(async ({ context, input }) => {
          return context.schedulerService.remove(input.id);
        }),
      run: t
        .input(schemas.scheduler.run.input)
        .output(schemas.scheduler.run.output)
        .handler(async ({ context, input }) => {
          return context.schedulerService.run(input.id);
        }),
      history: t
        .input(schemas.scheduler.history.input)
        .output(schemas.scheduler.history.output)
        .handler(({ context, input }) => {
          return context.schedulerService.getHistory(input.jobId);
        }),
      subscribe: t
        .input(schemas.scheduler.subscribe.input)
        .output(schemas.scheduler.subscribe.output)
        .handler(async function* ({ context, input, signal }) {
          if (signal?.aborted) return;

          const queue = createAsyncEventQueue<ReturnType<typeof context.schedulerService.list>>();

          // Push initial state
          queue.push(context.schedulerService.list(input.projectPath));

          const unsubscribe = context.schedulerService.subscribe((jobs) => {
            queue.push(jobs);
          });

          const onAbort = () => {
            queue.end();
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            queue.end();
            unsubscribe();
          }
        }),
    },

    // Sync — GitHub config backup
    sync: {
      getConfig: t
        .input(schemas.sync.getConfig.input)
        .output(schemas.sync.getConfig.output)
        .handler(({ context }) => {
          const cfg = context.config.loadConfigOrDefault();
          return cfg.sync ?? null;
        }),
      saveConfig: t
        .input(schemas.sync.saveConfig.input)
        .output(schemas.sync.saveConfig.output)
        .handler(async ({ context, input }) => {
          await context.syncService.configure(input);
          return { success: true };
        }),
      getStatus: t
        .input(schemas.sync.getStatus.input)
        .output(schemas.sync.getStatus.output)
        .handler(({ context }) => {
          return context.syncService.getStatus();
        }),
      push: t
        .input(schemas.sync.push.input)
        .output(schemas.sync.push.output)
        .handler(async ({ context }) => {
          return context.syncService.push();
        }),
      pull: t
        .input(schemas.sync.pull.input)
        .output(schemas.sync.pull.output)
        .handler(async ({ context }) => {
          return context.syncService.pull();
        }),
      disconnect: t
        .input(schemas.sync.disconnect.input)
        .output(schemas.sync.disconnect.output)
        .handler(async ({ context }) => {
          await context.syncService.disconnect();
          return { success: true };
        }),
      subscribe: t
        .input(schemas.sync.subscribe.input)
        .output(schemas.sync.subscribe.output)
        .handler(async function* ({ context, signal }) {
          if (signal?.aborted) return;

          const queue = createAsyncEventQueue<ReturnType<typeof context.syncService.getStatus>>();

          // Push initial status
          queue.push(context.syncService.getStatus());

          const unsubscribe = context.syncService.subscribe((status) => {
            queue.push(status);
          });

          const onAbort = () => {
            queue.end();
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            queue.end();
            unsubscribe();
          }
        }),
      checkGhAuth: t
        .input(schemas.sync.checkGhAuth.input)
        .output(schemas.sync.checkGhAuth.output)
        .handler(async ({ context }) => {
          return context.syncService.checkGhAuth();
        }),
      listRepos: t
        .input(schemas.sync.listRepos.input)
        .output(schemas.sync.listRepos.output)
        .handler(async ({ context }) => {
          return context.syncService.listGithubRepos();
        }),
      createRepo: t
        .input(schemas.sync.createRepo.input)
        .output(schemas.sync.createRepo.output)
        .handler(async ({ context, input }) => {
          return context.syncService.createGithubRepo(input.name);
        }),
    },

    update: {
      check: t
        .input(schemas.update.check.input)
        .output(schemas.update.check.output)
        .handler(async ({ context, input }) => {
          return context.updateService.check(input ?? undefined);
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
        .handler(async function* ({ context, signal }) {
          if (signal?.aborted) {
            return;
          }

          const queue = createAsyncEventQueue<UpdateStatus>();
          const unsubscribe = context.updateService.onStatus(queue.push);

          const onAbort = () => {
            queue.end();
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            yield* queue.iterate();
          } finally {
            signal?.removeEventListener("abort", onAbort);
            queue.end();
            unsubscribe();
          }
        }),
      getChannel: t
        .input(schemas.update.getChannel.input)
        .output(schemas.update.getChannel.output)
        .handler(({ context }) => {
          return context.updateService.getChannel();
        }),
      setChannel: t
        .input(schemas.update.setChannel.input)
        .output(schemas.update.setChannel.output)
        .handler(async ({ context, input }) => {
          await context.updateService.setChannel(input.channel);
        }),
    },
    menu: {
      onOpenSettings: t
        .input(schemas.menu.onOpenSettings.input)
        .output(schemas.menu.onOpenSettings.output)
        .handler(async function* ({ context, signal }) {
          if (signal?.aborted) {
            return;
          }

          // Use a sentinel value to signal events since void/undefined can't be queued
          const queue = createAsyncEventQueue<true>();
          const unsubscribe = context.menuEventService.onOpenSettings(() => queue.push(true));

          const onAbort = () => {
            queue.end();
          };

          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }

          try {
            for await (const _ of queue.iterate()) {
              yield undefined;
            }
          } finally {
            signal?.removeEventListener("abort", onAbort);
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
          return context.minionService.debugTriggerStreamError(
            input.minionId,
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
            envDisabled: process.env.LATTICE_DISABLE_TELEMETRY === "1",
          };
        }),
      setEnabled: t
        .input(schemas.telemetry.setEnabled.input)
        .output(schemas.telemetry.setEnabled.output)
        .handler(async ({ context, input }) => {
          // Persist preference to config.json
          await context.config.setTelemetryEnabled(input.enabled);

          if (input.enabled) {
            await context.telemetryService.enable();
          } else {
            await context.telemetryService.disable();
          }

          return {
            enabled: context.telemetryService.isEnabled(),
            explicit: context.telemetryService.isExplicitlyDisabled(),
            envDisabled: process.env.LATTICE_DISABLE_TELEMETRY === "1",
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
    analytics: {
      getSummary: t
        .input(schemas.analytics.getSummary.input)
        .output(schemas.analytics.getSummary.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getSummary(
            input.projectPath ?? null,
            input.from ?? null,
            input.to ?? null
          );
        }),
      getSpendOverTime: t
        .input(schemas.analytics.getSpendOverTime.input)
        .output(schemas.analytics.getSpendOverTime.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getSpendOverTime(input);
        }),
      getSpendByProject: t
        .input(schemas.analytics.getSpendByProject.input)
        .output(schemas.analytics.getSpendByProject.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getSpendByProject(input.from ?? null, input.to ?? null);
        }),
      getSpendByModel: t
        .input(schemas.analytics.getSpendByModel.input)
        .output(schemas.analytics.getSpendByModel.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getSpendByModel(
            input.projectPath ?? null,
            input.from ?? null,
            input.to ?? null
          );
        }),
      getTimingDistribution: t
        .input(schemas.analytics.getTimingDistribution.input)
        .output(schemas.analytics.getTimingDistribution.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getTimingDistribution(
            input.metric,
            input.projectPath ?? null,
            input.from ?? null,
            input.to ?? null
          );
        }),
      getAgentCostBreakdown: t
        .input(schemas.analytics.getAgentCostBreakdown.input)
        .output(schemas.analytics.getAgentCostBreakdown.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getAgentCostBreakdown(
            input.projectPath ?? null,
            input.from ?? null,
            input.to ?? null
          );
        }),
      getCacheHitRatioByProvider: t
        .input(schemas.analytics.getCacheHitRatioByProvider.input)
        .output(schemas.analytics.getCacheHitRatioByProvider.output)
        .handler(async ({ context, input }) => {
          return context.analyticsService.getCacheHitRatioByProvider(
            input.projectPath ?? null,
            input.from ?? null,
            input.to ?? null
          );
        }),
      rebuildDatabase: t
        .input(schemas.analytics.rebuildDatabase.input)
        .output(schemas.analytics.rebuildDatabase.output)
        .handler(async ({ context }) => {
          return context.analyticsService.rebuildAll();
        }),
    },
    ssh: {
      prompt: {
        subscribe: t
          .input(schemas.ssh.prompt.subscribe.input)
          .output(schemas.ssh.prompt.subscribe.output)
          .handler(async function* ({ context, signal }) {
            if (signal?.aborted) return;

            const service = context.sshPromptService;
            const releaseResponder = service.registerInteractiveResponder();
            const queue = createAsyncEventQueue<SshPromptEvent>();

            const onRequest = (req: SshPromptRequest) =>
              queue.push({ type: "request" as const, ...req });
            const onRemoved = (requestId: string) =>
              queue.push({ type: "removed" as const, requestId });

            // Atomic handshake: register listener + snapshot in one step.
            // No requests can be lost between snapshot and subscription.
            const { snapshot, unsubscribe } = service.subscribeRequests(onRequest, onRemoved);
            for (const req of snapshot) {
              queue.push({ type: "request" as const, ...req });
            }

            const onAbort = () => queue.end();
            signal?.addEventListener("abort", onAbort, { once: true });

            try {
              yield* queue.iterate();
            } finally {
              signal?.removeEventListener("abort", onAbort);
              releaseResponder();
              queue.end();
              unsubscribe();
            }
          }),
        respond: t
          .input(schemas.ssh.prompt.respond.input)
          .output(schemas.ssh.prompt.respond.output)
          .handler(({ context, input }) => {
            context.sshPromptService.respond(input.requestId, input.response);
            return Ok(undefined);
          }),
      },
    },
  });
};

export type AppRouter = ReturnType<typeof router>;
