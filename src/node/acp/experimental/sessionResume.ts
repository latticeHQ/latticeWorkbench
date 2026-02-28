import assert from "node:assert/strict";
import path from "node:path";
import { realpath } from "node:fs/promises";
import type { LoadSessionRequest, LoadSessionResponse } from "@agentclientprotocol/sdk";
import { isWorktreeRuntime, type RuntimeMode } from "@/common/types/runtime";
import type { NegotiatedCapabilities } from "../capabilities";
import { buildConfigOptions } from "../configOptions";
import { resolveAgentAiSettings, type ResolvedAiSettings } from "../resolveAgentAiSettings";
import type { ServerConnection } from "../serverConnection";
import type { SessionManager } from "../sessionManager";

type MinionInfo = NonNullable<
  Awaited<ReturnType<ServerConnection["client"]["minion"]["getInfo"]>>
>;

export interface ResumedSessionContext {
  sessionId: string;
  minionId: string;
  runtimeMode: RuntimeMode;
  agentId: string;
  aiSettings: ResolvedAiSettings;
  response: LoadSessionResponse;
}

export interface SessionResumeDependencies {
  server: ServerConnection;
  sessionManager: SessionManager;
  negotiatedCapabilities: NegotiatedCapabilities | null;
  defaultAgentId: string;
  /**
   * Agent ID from prior ACP in-memory session state (set via
   * session/set_config_option mode switches).  Takes precedence over
   * minion.agentId so that mode selections survive reconnect/reload.
   */
  existingSessionAgentId?: string;
}

function resolveRuntimeMode(minion: MinionInfo): RuntimeMode {
  if (isWorktreeRuntime(minion.runtimeConfig)) {
    return "worktree";
  }

  return minion.runtimeConfig.type;
}

function stripTrailingPathSeparators(value: string): string {
  const root = path.parse(value).root;
  let normalized = value;

  while (
    normalized.length > root.length &&
    (normalized.endsWith(path.posix.sep) || normalized.endsWith(path.win32.sep))
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function normalizePathCasingForComparison(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function canonicalizePathForMinionMatch(value: string): Promise<string> {
  const trimmed = value.trim();
  assert(trimmed.length > 0, "canonicalizePathForMinionMatch: value must be non-empty");

  const resolvedPath = stripTrailingPathSeparators(path.normalize(path.resolve(trimmed)));

  try {
    const realPathValue = await realpath(resolvedPath);
    return normalizePathCasingForComparison(
      stripTrailingPathSeparators(path.normalize(realPathValue))
    );
  } catch {
    // Best-effort canonicalization: unresolved paths (e.g., stale minions or
    // platform-specific virtualization) still compare via normalized absolute form.
    return normalizePathCasingForComparison(resolvedPath);
  }
}

export async function loadSessionFromMinion(
  params: LoadSessionRequest,
  deps: SessionResumeDependencies
): Promise<ResumedSessionContext> {
  const requestedSessionId = params.sessionId.trim();
  assert(requestedSessionId.length > 0, "loadSessionFromMinion: sessionId must be non-empty");

  const requestedCwd = params.cwd.trim();
  assert(requestedCwd.length > 0, "loadSessionFromMinion: cwd must be non-empty");

  const minion = await deps.server.client.minion.getInfo({ minionId: requestedSessionId });
  if (!minion) {
    throw new Error(`loadSessionFromMinion: minion '${requestedSessionId}' was not found`);
  }

  const [canonicalRequestedCwd, canonicalProjectPath, canonicalMinionPath] = await Promise.all([
    canonicalizePathForMinionMatch(requestedCwd),
    canonicalizePathForMinionMatch(minion.projectPath),
    canonicalizePathForMinionMatch(minion.namedMinionPath),
  ]);

  const cwdMatchesMinion =
    canonicalProjectPath === canonicalRequestedCwd ||
    canonicalMinionPath === canonicalRequestedCwd;
  assert(
    cwdMatchesMinion,
    `loadSessionFromMinion: minion '${requestedSessionId}' is not in cwd '${requestedCwd}'`
  );

  const minionId = minion.id;
  const runtimeMode = resolveRuntimeMode(minion);

  deps.sessionManager.registerSession(
    requestedSessionId,
    minionId,
    runtimeMode,
    deps.negotiatedCapabilities ?? undefined
  );

  // Prefer the ACP session's prior agent selection (from set_config_option)
  // over minion.agentId so that mode switches survive reconnect/reload.
  const agentId = deps.existingSessionAgentId ?? minion.agentId ?? deps.defaultAgentId;
  const aiSettings =
    minion.aiSettingsByAgent?.[agentId] ??
    minion.aiSettings ??
    (await resolveAgentAiSettings(deps.server.client, agentId, minionId));

  const configOptions = await buildConfigOptions(deps.server.client, minionId, {
    activeAgentId: agentId,
  });

  return {
    sessionId: requestedSessionId,
    minionId,
    runtimeMode,
    agentId,
    aiSettings,
    response: {
      configOptions,
    },
  };
}
