/**
 * Lattice SDK — Agent & Skill operations (5 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function listAgents(c: RouterClient<AppRouter>, opts?: { projectPath?: string; minionId?: string; includeDisabled?: boolean }) {
  return c.agents.list(opts as Parameters<typeof c.agents.list>[0]);
}

export async function getAgent(c: RouterClient<AppRouter>, agentId: string, opts?: { projectPath?: string; minionId?: string }) {
  return c.agents.get({ agentId, ...opts } as Parameters<typeof c.agents.get>[0]);
}

export async function listSkills(c: RouterClient<AppRouter>, opts?: { projectPath?: string; minionId?: string }) {
  return c.agentSkills.list(opts as Parameters<typeof c.agentSkills.list>[0]);
}

export async function getSkill(c: RouterClient<AppRouter>, skillName: string, opts?: { projectPath?: string; minionId?: string }) {
  return c.agentSkills.get({ skillName, ...opts } as Parameters<typeof c.agentSkills.get>[0]);
}

export async function listSkillDiagnostics(c: RouterClient<AppRouter>, opts?: { projectPath?: string; minionId?: string }) {
  return c.agentSkills.listDiagnostics(opts as Parameters<typeof c.agentSkills.listDiagnostics>[0]);
}
