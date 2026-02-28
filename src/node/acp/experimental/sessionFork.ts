import assert from "node:assert/strict";
import type { ForkSessionRequest, ForkSessionResponse } from "@agentclientprotocol/sdk";
import { isWorktreeRuntime, type RuntimeMode } from "@/common/types/runtime";
import type { NegotiatedCapabilities } from "../capabilities";
import { buildConfigOptions } from "../configOptions";
import { resolveAgentAiSettings, type ResolvedAiSettings } from "../resolveAgentAiSettings";
import type { ServerConnection } from "../serverConnection";
import type { SessionManager } from "../sessionManager";

type MinionInfo = NonNullable<
  Awaited<ReturnType<ServerConnection["client"]["minion"]["getInfo"]>>
>;

export interface ForkedSessionContext {
  sessionId: string;
  minionId: string;
  runtimeMode: RuntimeMode;
  agentId: string;
  aiSettings: ResolvedAiSettings;
  response: ForkSessionResponse;
}

export interface SessionForkDependencies {
  server: ServerConnection;
  sessionManager: SessionManager;
  negotiatedCapabilities: NegotiatedCapabilities | null;
  defaultAgentId: string;
  /** The source ACP session's current agent selection, if available. */
  sourceSessionAgentId?: string;
}

function resolveRuntimeMode(minion: MinionInfo): RuntimeMode {
  if (isWorktreeRuntime(minion.runtimeConfig)) {
    return "worktree";
  }

  return minion.runtimeConfig.type;
}

export async function forkSessionFromMinion(
  params: ForkSessionRequest,
  deps: SessionForkDependencies,
  newName?: string
): Promise<ForkedSessionContext> {
  const sourceSessionId = params.sessionId.trim();
  assert(sourceSessionId.length > 0, "forkSessionFromMinion: sessionId must be non-empty");

  const sourceMinionId = deps.sessionManager.getMinionId(sourceSessionId);
  const sourceMinion = await deps.server.client.minion.getInfo({
    minionId: sourceMinionId,
  });
  if (!sourceMinion) {
    throw new Error(
      `forkSessionFromMinion: source minion '${sourceMinionId}' was not found`
    );
  }

  const forkResult = await deps.server.client.minion.fork({
    sourceMinionId,
    newName,
  });
  if (!forkResult.success) {
    throw new Error(`forkSessionFromMinion: minion.fork failed: ${forkResult.error}`);
  }

  const minionId = forkResult.metadata.id;
  const sessionId = minionId;
  const runtimeMode = resolveRuntimeMode(forkResult.metadata);

  deps.sessionManager.registerSession(
    sessionId,
    minionId,
    runtimeMode,
    deps.negotiatedCapabilities ?? undefined
  );

  // Prefer the source ACP session's active agent selection over minion
  // metadata, so forks inherit the mode the user switched to in-session.
  const agentId = deps.sourceSessionAgentId ?? sourceMinion.agentId ?? deps.defaultAgentId;
  const aiSettings = await resolveAgentAiSettings(deps.server.client, agentId, minionId);
  const configOptions = await buildConfigOptions(deps.server.client, minionId, {
    activeAgentId: agentId,
  });

  return {
    sessionId,
    minionId,
    runtimeMode,
    agentId,
    aiSettings,
    response: {
      sessionId,
      configOptions,
    },
  };
}
