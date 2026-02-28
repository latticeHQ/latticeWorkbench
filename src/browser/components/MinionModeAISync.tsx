import { useEffect, useRef } from "react";
import { useAgent } from "@/browser/contexts/AgentContext";
import {
  readPersistedState,
  updatePersistedState,
  usePersistedState,
} from "@/browser/hooks/usePersistedState";
import {
  getModelKey,
  getThinkingLevelKey,
  getMinionAISettingsByAgentKey,
  AGENT_AI_DEFAULTS_KEY,
} from "@/common/constants/storage";
import { getDefaultModel } from "@/browser/hooks/useModelsFromSettings";
import { setMinionModelWithOrigin } from "@/browser/utils/modelChange";
import {
  resolveMinionAiSettingsForAgent,
  type MinionAISettingsCache,
} from "@/browser/utils/minionModeAi";
import type { ThinkingLevel } from "@/common/types/thinking";
import type { AgentAiDefaults } from "@/common/types/agentAiDefaults";

export function MinionModeAISync(props: { minionId: string }): null {
  const minionId = props.minionId;
  const { agentId } = useAgent();

  const [agentAiDefaults] = usePersistedState<AgentAiDefaults>(
    AGENT_AI_DEFAULTS_KEY,
    {},
    { listener: true }
  );
  const [minionByAgent] = usePersistedState<MinionAISettingsCache>(
    getMinionAISettingsByAgentKey(minionId),
    {},
    { listener: true }
  );

  // User request: this effect runs on mount and during background sync (defaults/config).
  // Only treat *real* agentId changes as explicit (origin "agent"); everything else is "sync"
  // so we don't show context-switch warnings on minion entry.
  const prevAgentIdRef = useRef<string | null>(null);
  const prevMinionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const fallbackModel = getDefaultModel();
    const modelKey = getModelKey(minionId);
    const thinkingKey = getThinkingLevelKey(minionId);

    const normalizedAgentId =
      typeof agentId === "string" && agentId.trim().length > 0
        ? agentId.trim().toLowerCase()
        : "exec";

    const isExplicitAgentSwitch =
      prevAgentIdRef.current !== null &&
      prevMinionIdRef.current === minionId &&
      prevAgentIdRef.current !== normalizedAgentId;

    // Update refs for the next run (even if no model changes).
    prevAgentIdRef.current = normalizedAgentId;
    prevMinionIdRef.current = minionId;

    const existingModel = readPersistedState<string>(modelKey, fallbackModel);
    const existingThinking = readPersistedState<ThinkingLevel>(thinkingKey, "off");

    const { resolvedModel, resolvedThinking } = resolveMinionAiSettingsForAgent({
      agentId: normalizedAgentId,
      agentAiDefaults,
      // Keep deterministic handoff behavior: background sync should trust the
      // currently active minion model, but explicit mode switches should
      // restore the selected agent's per-minion override (if any).
      minionByAgent,
      useMinionByAgentFallback: isExplicitAgentSwitch,
      fallbackModel,
      existingModel,
      existingThinking,
    });

    if (existingModel !== resolvedModel) {
      setMinionModelWithOrigin(
        minionId,
        resolvedModel,
        isExplicitAgentSwitch ? "agent" : "sync"
      );
    }

    if (existingThinking !== resolvedThinking) {
      updatePersistedState(thinkingKey, resolvedThinking);
    }
  }, [agentAiDefaults, agentId, minionByAgent, minionId]);

  return null;
}
