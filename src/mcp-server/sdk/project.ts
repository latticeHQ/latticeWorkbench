/**
 * Lattice SDK — Project operations (25 functions)
 *
 * Project CRUD, branches, crews, secrets, MCP servers, idle compaction.
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

// ── Project CRUD ─────────────────────────────────────────────────────────

export async function listProjects(c: RouterClient<AppRouter>) {
  return c.projects.list();
}

export async function createProject(c: RouterClient<AppRouter>, projectPath: string) {
  const result = await c.projects.create({ projectPath });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

export async function removeProject(c: RouterClient<AppRouter>, projectPath: string) {
  const result = await c.projects.remove({ projectPath });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

export async function listBranches(c: RouterClient<AppRouter>, projectPath: string) {
  return c.projects.listBranches({ projectPath });
}

export async function gitInit(c: RouterClient<AppRouter>, projectPath: string) {
  const result = await c.projects.gitInit({ projectPath });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

export async function getFileCompletions(c: RouterClient<AppRouter>, projectPath: string, query: string, limit?: number) {
  return c.projects.getFileCompletions({ projectPath, query, limit });
}

export async function runtimeAvailability(c: RouterClient<AppRouter>, projectPath: string) {
  return c.projects.runtimeAvailability({ projectPath });
}

export async function getDefaultProjectDir(c: RouterClient<AppRouter>) {
  return c.projects.getDefaultProjectDir();
}

export async function setDefaultProjectDir(c: RouterClient<AppRouter>, path: string) {
  return c.projects.setDefaultProjectDir({ path });
}

// ── Crews ─────────────────────────────────────────────────────────────

export async function listCrews(c: RouterClient<AppRouter>, projectPath: string) {
  return c.projects.crews.list({ projectPath });
}

export async function createCrew(c: RouterClient<AppRouter>, projectPath: string, name: string, color?: string) {
  return c.projects.crews.create({ projectPath, name, color });
}

export async function updateCrew(c: RouterClient<AppRouter>, projectPath: string, crewId: string, opts: { name?: string; color?: string }) {
  return c.projects.crews.update({ projectPath, crewId, ...opts });
}

export async function removeCrew(c: RouterClient<AppRouter>, projectPath: string, crewId: string) {
  return c.projects.crews.remove({ projectPath, crewId });
}

export async function reorderCrews(c: RouterClient<AppRouter>, projectPath: string, crewIds: string[]) {
  return c.projects.crews.reorder({ projectPath, crewIds });
}

export async function assignMinionToCrew(c: RouterClient<AppRouter>, projectPath: string, minionId: string, crewId: string | null) {
  return c.projects.crews.assignMinion({ projectPath, minionId, crewId });
}

// ── Secrets ──────────────────────────────────────────────────────────────

export async function getProjectSecrets(c: RouterClient<AppRouter>, projectPath: string) {
  return c.projects.secrets.get({ projectPath });
}

export async function updateProjectSecrets(c: RouterClient<AppRouter>, projectPath: string, secrets: Array<{ name: string; value: string }>) {
  return c.projects.secrets.update({ projectPath, secrets: secrets.map(s => ({ key: s.name, value: s.value })) });
}

// ── Project MCP servers ──────────────────────────────────────────────────

export async function listProjectMcpServers(c: RouterClient<AppRouter>, projectPath: string) {
  return c.projects.mcp.list({ projectPath });
}

export async function addProjectMcpServer(c: RouterClient<AppRouter>, input: { projectPath: string; name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string }) {
  return c.projects.mcp.add(input as Parameters<typeof c.projects.mcp.add>[0]);
}

export async function removeProjectMcpServer(c: RouterClient<AppRouter>, projectPath: string, name: string) {
  return c.projects.mcp.remove({ projectPath, name } as Parameters<typeof c.projects.mcp.remove>[0]);
}

export async function testProjectMcpServer(c: RouterClient<AppRouter>, projectPath: string, name: string) {
  return c.projects.mcp.test({ projectPath, name } as Parameters<typeof c.projects.mcp.test>[0]);
}

export async function setProjectMcpServerEnabled(c: RouterClient<AppRouter>, projectPath: string, name: string, enabled: boolean) {
  return c.projects.mcp.setEnabled({ projectPath, name, enabled } as Parameters<typeof c.projects.mcp.setEnabled>[0]);
}

export async function setProjectMcpToolAllowlist(c: RouterClient<AppRouter>, projectPath: string, name: string, allowlist: string[] | null) {
  return c.projects.mcp.setToolAllowlist({ projectPath, name, allowlist } as unknown as Parameters<typeof c.projects.mcp.setToolAllowlist>[0]);
}

// ── Idle compaction ──────────────────────────────────────────────────────

export async function getIdleCompaction(c: RouterClient<AppRouter>, projectPath: string) {
  return c.projects.idleCompaction.get({ projectPath });
}

export async function setIdleCompaction(c: RouterClient<AppRouter>, projectPath: string, hours: number | null) {
  return c.projects.idleCompaction.set({ projectPath, hours });
}
