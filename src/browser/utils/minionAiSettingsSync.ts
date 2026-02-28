import type { ThinkingLevel } from "@/common/types/thinking";

interface MinionAiSettingsSnapshot {
  model: string;
  thinkingLevel: ThinkingLevel;
}

const pendingAiSettingsByMinion = new Map<string, MinionAiSettingsSnapshot>();

function getPendingKey(minionId: string, agentId: string): string {
  return `${minionId}:${agentId}`;
}

export function markPendingMinionAiSettings(
  minionId: string,
  agentId: string,
  settings: MinionAiSettingsSnapshot
): void {
  if (!minionId || !agentId) {
    return;
  }
  pendingAiSettingsByMinion.set(getPendingKey(minionId, agentId), settings);
}

export function clearPendingMinionAiSettings(minionId: string, agentId: string): void {
  if (!minionId || !agentId) {
    return;
  }
  pendingAiSettingsByMinion.delete(getPendingKey(minionId, agentId));
}

export function shouldApplyMinionAiSettingsFromBackend(
  minionId: string,
  agentId: string,
  incoming: MinionAiSettingsSnapshot
): boolean {
  if (!minionId || !agentId) {
    return true;
  }

  const key = getPendingKey(minionId, agentId);
  const pending = pendingAiSettingsByMinion.get(key);
  if (!pending) {
    return true;
  }

  const matches =
    pending.model === incoming.model && pending.thinkingLevel === incoming.thinkingLevel;
  if (matches) {
    pendingAiSettingsByMinion.delete(key);
    return true;
  }

  return false;
}
