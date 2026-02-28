import type { AgentAiDefaults } from "@/common/types/agentAiDefaults";
import { coerceThinkingLevel, type ThinkingLevel } from "@/common/types/thinking";

export type MinionAISettingsCache = Partial<
  Record<string, { model: string; thinkingLevel: ThinkingLevel }>
>;

function normalizeAgentId(agentId: string): string {
  return typeof agentId === "string" && agentId.trim().length > 0
    ? agentId.trim().toLowerCase()
    : "exec";
}

// Keep agent -> model/thinking precedence in one place so mode switches that send immediately
// (like propose_plan Implement / Start Orchestrator) resolve the same settings as sync effects.
export function resolveMinionAiSettingsForAgent(args: {
  agentId: string;
  agentAiDefaults: AgentAiDefaults;
  minionByAgent?: MinionAISettingsCache;
  useMinionByAgentFallback?: boolean;
  fallbackModel: string;
  existingModel: string;
  existingThinking: ThinkingLevel;
}): { resolvedModel: string; resolvedThinking: ThinkingLevel } {
  const normalizedAgentId = normalizeAgentId(args.agentId);
  const globalDefault = args.agentAiDefaults[normalizedAgentId];
  const minionOverride = args.minionByAgent?.[normalizedAgentId];

  const configuredModelCandidate = globalDefault?.modelString;
  const configuredModel =
    typeof configuredModelCandidate === "string" ? configuredModelCandidate.trim() : undefined;
  const minionOverrideModel =
    args.useMinionByAgentFallback && typeof minionOverride?.model === "string"
      ? minionOverride.model
      : undefined;
  const inheritedModelCandidate =
    minionOverrideModel ??
    (typeof args.existingModel === "string" ? args.existingModel : undefined) ??
    "";
  const inheritedModel = inheritedModelCandidate.trim();
  const resolvedModel =
    configuredModel && configuredModel.length > 0
      ? configuredModel
      : inheritedModel.length > 0
        ? inheritedModel
        : args.fallbackModel;

  // Persisted minion settings can be stale/corrupt; re-validate inherited values
  // so mode sync keeps self-healing behavior instead of propagating invalid options.
  const minionOverrideThinking = args.useMinionByAgentFallback
    ? coerceThinkingLevel(minionOverride?.thinkingLevel)
    : undefined;
  const inheritedThinking = minionOverrideThinking ?? coerceThinkingLevel(args.existingThinking);
  const resolvedThinking =
    coerceThinkingLevel(globalDefault?.thinkingLevel) ?? inheritedThinking ?? "off";

  return { resolvedModel, resolvedThinking };
}
