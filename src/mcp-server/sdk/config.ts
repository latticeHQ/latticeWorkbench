/**
 * Lattice SDK — Config & Provider operations (13 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function getConfig(c: RouterClient<AppRouter>) { return c.config.getConfig(); }
export async function saveConfig(c: RouterClient<AppRouter>, input: Parameters<typeof c.config.saveConfig>[0]) { return c.config.saveConfig(input); }
export async function updateAgentAiDefaults(c: RouterClient<AppRouter>, agentAiDefaults: Record<string, { modelString?: string; thinkingLevel?: string; enabled?: boolean }>) {
  return c.config.updateAgentAiDefaults({ agentAiDefaults } as Parameters<typeof c.config.updateAgentAiDefaults>[0]);
}
export async function updateModelPreferences(c: RouterClient<AppRouter>, input: Parameters<typeof c.config.updateModelPreferences>[0]) { return c.config.updateModelPreferences(input); }
export async function updateRuntimeEnablement(c: RouterClient<AppRouter>, input: Parameters<typeof c.config.updateRuntimeEnablement>[0]) { return c.config.updateRuntimeEnablement(input); }
export async function updateLatticePrefs(c: RouterClient<AppRouter>, stopLatticeMinionOnArchive: boolean) {
  return c.config.updateLatticePrefs({ stopLatticeMinionOnArchive });
}
export async function unenrollLatticeGovernor(c: RouterClient<AppRouter>) { return c.config.unenrollLatticeGovernor(); }

// Providers
export async function listProviders(c: RouterClient<AppRouter>) { return c.providers.list(); }
export async function getProviderConfig(c: RouterClient<AppRouter>) { return c.providers.getConfig(); }
export async function setProviderConfig(c: RouterClient<AppRouter>, provider: string, keyPath: string[], value: string) {
  return c.providers.setProviderConfig({ provider, keyPath, value });
}
export async function setProviderModels(c: RouterClient<AppRouter>, provider: string, models: Array<{ id: string; name?: string; enabled?: boolean }>) {
  return c.providers.setModels({ provider, models } as Parameters<typeof c.providers.setModels>[0]);
}
