import assert from "node:assert/strict";
import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import type { AgentDefinitionFrontmatter } from "@/common/types/agentDefinition";
import { getThinkingOptionLabel, isThinkingLevel } from "@/common/types/thinking";
import { enforceThinkingPolicy, getThinkingPolicyForModel } from "@/common/utils/thinking/policy";
import { getBuiltInAgentDefinitions } from "@/node/services/agentDefinitions/builtInAgentDefinitions";
import type { ORPCClient } from "./serverConnection";
import { resolveAgentAiSettings, type ResolvedAiSettings } from "./resolveAgentAiSettings";

export const AGENT_MODE_CONFIG_ID = "agentMode";
const MODEL_CONFIG_ID = "model";
const THINKING_LEVEL_CONFIG_ID = "thinkingLevel";

const DEFAULT_AGENT_MODE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  exec: "Implement changes in the repository",
  ask: "Delegate questions to Explore sub-agents and synthesize an answer.",
  plan: "Create a plan before coding",
  auto: "Automatically selects the best agent for your task",
};

interface ExposedAgentMode {
  value: string;
  label: string;
  description?: string;
}

function isUiSelectableAgentMode(frontmatter: AgentDefinitionFrontmatter): boolean {
  if (frontmatter.disabled === true || frontmatter.ui?.disabled === true) {
    return false;
  }

  if (frontmatter.ui?.hidden != null) {
    return !frontmatter.ui.hidden;
  }

  if (frontmatter.ui?.selectable != null) {
    return frontmatter.ui.selectable;
  }

  return true;
}

const BUILTIN_AGENT_MODE_ORDER = getBuiltInAgentDefinitions()
  .filter((agent) => isUiSelectableAgentMode(agent.frontmatter))
  .map((agent) => agent.id);

const BUILTIN_AGENT_MODE_ORDER_INDEX = new Map<string, number>(
  BUILTIN_AGENT_MODE_ORDER.map((agentId, index) => [agentId, index])
);

assert(
  BUILTIN_AGENT_MODE_ORDER_INDEX.size === BUILTIN_AGENT_MODE_ORDER.length,
  "configOptions: BUILTIN_AGENT_MODE_ORDER must not contain duplicate agent IDs"
);

function sortAgentsForConfigOptions(
  agents: Awaited<ReturnType<ORPCClient["agents"]["list"]>>
): Awaited<ReturnType<ORPCClient["agents"]["list"]>> {
  return [...agents].sort((a, b) => {
    const aBuiltInIndex = BUILTIN_AGENT_MODE_ORDER_INDEX.get(a.id);
    const bBuiltInIndex = BUILTIN_AGENT_MODE_ORDER_INDEX.get(b.id);

    const aIsBuiltIn = aBuiltInIndex != null;
    const bIsBuiltIn = bBuiltInIndex != null;

    if (aIsBuiltIn && bIsBuiltIn) {
      return aBuiltInIndex - bBuiltInIndex;
    }

    if (aIsBuiltIn) {
      return -1;
    }

    if (bIsBuiltIn) {
      return 1;
    }

    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }

    return a.id.localeCompare(b.id);
  });
}

function resolveBuiltInExposedAgentModes(): ExposedAgentMode[] {
  return BUILTIN_AGENT_MODE_ORDER.flatMap((agentId) => {
    const builtIn = getBuiltInAgentDefinitions().find((agent) => agent.id === agentId);
    if (builtIn == null) {
      return [];
    }

    return [
      {
        value: builtIn.id,
        label: builtIn.frontmatter.name,
        description: builtIn.frontmatter.description ?? DEFAULT_AGENT_MODE_DESCRIPTIONS[builtIn.id],
      },
    ];
  });
}

async function resolveExposedAgentModes(
  client: ORPCClient,
  minionId: string
): Promise<ExposedAgentMode[]> {
  try {
    const selectableAgents = (await client.agents.list({ minionId })).filter(
      (agent) => agent.uiSelectable
    );

    return sortAgentsForConfigOptions(selectableAgents).map((agent) => ({
      value: agent.id,
      label: agent.name,
      description: agent.description ?? DEFAULT_AGENT_MODE_DESCRIPTIONS[agent.id],
    }));
  } catch {
    // ACP test harnesses and legacy embed points may provide partial ORPC clients
    // without the agents router. Fall back to built-in selectable agent metadata
    // so session config remains available.
    return resolveBuiltInExposedAgentModes();
  }
}

type MinionInfo = NonNullable<Awaited<ReturnType<ORPCClient["minion"]["getInfo"]>>>;
type UpdateAgentAiSettingsResult = Awaited<
  ReturnType<ORPCClient["minion"]["updateAgentAISettings"]>
>;

interface BuildConfigOptionsArgs {
  activeAgentId?: string;
}

interface HandleSetConfigOptionArgs {
  activeAgentId?: string;
  onAgentModeChanged?: (agentId: string, aiSettings: ResolvedAiSettings) => Promise<void> | void;
}

function isModeAgentId(agentId: string): agentId is "plan" | "exec" {
  return agentId === "plan" || agentId === "exec";
}

function ensureUpdateSucceeded(result: UpdateAgentAiSettingsResult, operation: string): void {
  if (!result.success) {
    throw new Error(`${operation} failed: ${result.error}`);
  }
}

async function getMinionInfoOrThrow(
  client: ORPCClient,
  minionId: string
): Promise<MinionInfo> {
  const minion = await client.minion.getInfo({ minionId });
  if (!minion) {
    throw new Error(`Minion '${minionId}' was not found`);
  }

  return minion;
}

function getCurrentAgentId(minion: MinionInfo): string {
  return minion.agentId ?? "exec";
}

async function resolveCurrentAiSettings(
  client: ORPCClient,
  minion: MinionInfo,
  minionId: string,
  agentId: string
): Promise<ResolvedAiSettings> {
  const minionAiSettings = minion.aiSettingsByAgent?.[agentId] ?? minion.aiSettings;
  if (minionAiSettings) {
    return {
      model: minionAiSettings.model,
      thinkingLevel: enforceThinkingPolicy(
        minionAiSettings.model,
        minionAiSettings.thinkingLevel
      ),
    };
  }

  const resolvedDefaults = await resolveAgentAiSettings(client, agentId, minionId);
  return {
    model: resolvedDefaults.model,
    thinkingLevel: enforceThinkingPolicy(resolvedDefaults.model, resolvedDefaults.thinkingLevel),
  };
}

async function buildAgentModeSelectOptions(
  client: ORPCClient,
  minionId: string,
  currentAgentId: string
): Promise<SessionConfigSelectOption[]> {
  const options: SessionConfigSelectOption[] = (
    await resolveExposedAgentModes(client, minionId)
  ).map((mode) => ({
    value: mode.value,
    name: mode.label,
    description: mode.description,
  }));

  if (!options.some((option) => option.value === currentAgentId)) {
    options.unshift({ value: currentAgentId, name: currentAgentId });
  }

  return options;
}

function buildModelSelectOptions(currentModel: string): SessionConfigSelectOption[] {
  const options: SessionConfigSelectOption[] = Object.values(KNOWN_MODELS).map((model) => ({
    value: model.id,
    name: model.id,
  }));

  if (!options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, name: currentModel });
  }

  return options;
}

function buildThinkingLevelSelectOptions(modelString: string): SessionConfigSelectOption[] {
  const allowedThinkingLevels = getThinkingPolicyForModel(modelString);

  return allowedThinkingLevels.map((level) => ({
    value: level,
    name: getThinkingOptionLabel(level, modelString),
  }));
}

async function persistAgentAiSettings(
  client: ORPCClient,
  minionId: string,
  agentId: string,
  aiSettings: ResolvedAiSettings
): Promise<void> {
  if (isModeAgentId(agentId)) {
    const updateModeResult = await client.minion.updateModeAISettings({
      minionId,
      mode: agentId,
      aiSettings,
    });
    ensureUpdateSucceeded(updateModeResult, "minion.updateModeAISettings");
    return;
  }

  const updateAgentResult = await client.minion.updateAgentAISettings({
    minionId,
    agentId,
    aiSettings,
  });
  ensureUpdateSucceeded(updateAgentResult, "minion.updateAgentAISettings");
}

export async function buildConfigOptions(
  client: ORPCClient,
  minionId: string,
  args?: BuildConfigOptionsArgs
): Promise<SessionConfigOption[]> {
  assert(minionId.trim().length > 0, "buildConfigOptions: minionId must be non-empty");

  const minion = await getMinionInfoOrThrow(client, minionId);
  const overrideAgentId = args?.activeAgentId?.trim();
  const currentAgentId =
    typeof overrideAgentId === "string" && overrideAgentId.length > 0
      ? overrideAgentId
      : getCurrentAgentId(minion);
  const [currentAiSettings, agentModeOptions] = await Promise.all([
    resolveCurrentAiSettings(client, minion, minionId, currentAgentId),
    buildAgentModeSelectOptions(client, minionId, currentAgentId),
  ]);

  const effectiveThinkingLevel = enforceThinkingPolicy(
    currentAiSettings.model,
    currentAiSettings.thinkingLevel
  );

  const configOptions: SessionConfigOption[] = [
    {
      id: AGENT_MODE_CONFIG_ID,
      name: "Agent Mode",
      type: "select",
      category: "mode",
      currentValue: currentAgentId,
      options: agentModeOptions,
    },
    {
      id: MODEL_CONFIG_ID,
      name: "Model",
      type: "select",
      category: "model",
      currentValue: currentAiSettings.model,
      options: buildModelSelectOptions(currentAiSettings.model),
    },
    {
      id: THINKING_LEVEL_CONFIG_ID,
      name: "Thinking Level",
      type: "select",
      category: "thought_level",
      currentValue: effectiveThinkingLevel,
      options: buildThinkingLevelSelectOptions(currentAiSettings.model),
    },
  ];

  return configOptions;
}

export async function handleSetConfigOption(
  client: ORPCClient,
  minionId: string,
  configId: string,
  value: string,
  args?: HandleSetConfigOptionArgs
): Promise<SessionConfigOption[]> {
  const trimmedMinionId = minionId.trim();
  const trimmedConfigId = configId.trim();
  const trimmedValue = value.trim();

  assert(trimmedMinionId.length > 0, "handleSetConfigOption: minionId must be non-empty");
  assert(trimmedConfigId.length > 0, "handleSetConfigOption: configId must be non-empty");
  assert(trimmedValue.length > 0, "handleSetConfigOption: value must be non-empty");

  const minion = await getMinionInfoOrThrow(client, trimmedMinionId);
  const overrideAgentId = args?.activeAgentId?.trim();
  const currentAgentId =
    typeof overrideAgentId === "string" && overrideAgentId.length > 0
      ? overrideAgentId
      : getCurrentAgentId(minion);

  if (trimmedConfigId === AGENT_MODE_CONFIG_ID) {
    const nextAgentId = trimmedValue;

    // Prefer minion-specific settings already saved for the target agent
    // (e.g., user customized model/thinking for this mode).  Only fall back
    // to resolved defaults when no prior settings exist for the agent.
    const existingSettings = minion.aiSettingsByAgent?.[nextAgentId];
    const resolvedAiSettings =
      existingSettings?.model != null && existingSettings?.thinkingLevel != null
        ? { model: existingSettings.model, thinkingLevel: existingSettings.thinkingLevel }
        : await resolveAgentAiSettings(client, nextAgentId, trimmedMinionId);

    const normalizedAiSettings: ResolvedAiSettings = {
      model: resolvedAiSettings.model,
      thinkingLevel: enforceThinkingPolicy(
        resolvedAiSettings.model,
        resolvedAiSettings.thinkingLevel
      ),
    };

    await persistAgentAiSettings(client, trimmedMinionId, nextAgentId, normalizedAiSettings);
    if (args?.onAgentModeChanged != null) {
      await args.onAgentModeChanged(nextAgentId, normalizedAiSettings);
    }

    return buildConfigOptions(client, trimmedMinionId, { activeAgentId: nextAgentId });
  }

  const currentAiSettings = await resolveCurrentAiSettings(
    client,
    minion,
    trimmedMinionId,
    currentAgentId
  );

  if (trimmedConfigId === MODEL_CONFIG_ID) {
    const clampedThinkingLevel = enforceThinkingPolicy(
      trimmedValue,
      currentAiSettings.thinkingLevel
    );

    await persistAgentAiSettings(client, trimmedMinionId, currentAgentId, {
      model: trimmedValue,
      thinkingLevel: clampedThinkingLevel,
    });

    return buildConfigOptions(client, trimmedMinionId, { activeAgentId: currentAgentId });
  }

  if (trimmedConfigId === THINKING_LEVEL_CONFIG_ID) {
    if (!isThinkingLevel(trimmedValue)) {
      throw new Error(
        `handleSetConfigOption: value must be a valid ThinkingLevel, got '${trimmedValue}'`
      );
    }

    const clampedThinkingLevel = enforceThinkingPolicy(currentAiSettings.model, trimmedValue);

    await persistAgentAiSettings(client, trimmedMinionId, currentAgentId, {
      model: currentAiSettings.model,
      thinkingLevel: clampedThinkingLevel,
    });

    return buildConfigOptions(client, trimmedMinionId, { activeAgentId: currentAgentId });
  }

  throw new Error(`Unsupported config option id '${trimmedConfigId}'`);
}
