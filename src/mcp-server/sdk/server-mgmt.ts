/**
 * Lattice SDK — Server management, updates, signing, lattice, experiments (29 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

// Server
export async function getApiServerStatus(c: RouterClient<AppRouter>) { return c.server.getApiServerStatus(); }
export async function setApiServerSettings(c: RouterClient<AppRouter>, input: { bindHost?: string | null; port?: number | null; serveWebUi?: boolean | null }) {
  return c.server.setApiServerSettings({ bindHost: input.bindHost ?? null, port: input.port ?? null, serveWebUi: input.serveWebUi });
}
export async function getSshHost(c: RouterClient<AppRouter>) { return c.server.getSshHost(); }
export async function setSshHost(c: RouterClient<AppRouter>, sshHost: string | null) { return c.server.setSshHost({ sshHost }); }
export async function getLaunchProject(c: RouterClient<AppRouter>) { return c.server.getLaunchProject(); }

// Auth
export async function listAuthSessions(c: RouterClient<AppRouter>) { return c.serverAuth.listSessions(); }
export async function revokeAuthSession(c: RouterClient<AppRouter>, sessionId: string) { return c.serverAuth.revokeSession({ sessionId }); }
export async function revokeOtherAuthSessions(c: RouterClient<AppRouter>) { return c.serverAuth.revokeOtherSessions(); }

// Features
export async function getStatsTabState(c: RouterClient<AppRouter>) { return c.features.getStatsTabState(); }
export async function setStatsTabOverride(c: RouterClient<AppRouter>, override: "default" | "on" | "off") { return c.features.setStatsTabOverride({ override }); }

// Policy
export async function getPolicy(c: RouterClient<AppRouter>) { return c.policy.get(); }
export async function refreshPolicy(c: RouterClient<AppRouter>) { return c.policy.refreshNow(); }

// Updates
export async function checkForUpdates(c: RouterClient<AppRouter>, source?: "auto" | "manual") { return c.update.check({ source }); }
export async function downloadUpdate(c: RouterClient<AppRouter>) { return c.update.download(); }
export async function installUpdate(c: RouterClient<AppRouter>) { return c.update.install(); }
export async function getUpdateChannel(c: RouterClient<AppRouter>) { return c.update.getChannel(); }
export async function setUpdateChannel(c: RouterClient<AppRouter>, channel: "stable" | "nightly") { return c.update.setChannel({ channel }); }

// Signing
export async function getSigningCapabilities(c: RouterClient<AppRouter>) { return c.signing.capabilities({}); }
export async function signMessage(c: RouterClient<AppRouter>, content: string) { return c.signing.signMessage({ content }); }
export async function clearIdentityCache(c: RouterClient<AppRouter>) { return c.signing.clearIdentityCache({}); }

// Lattice
export async function getLatticeInfo(c: RouterClient<AppRouter>) { return c.lattice.getInfo(); }
export async function listLatticeTemplates(c: RouterClient<AppRouter>) { return c.lattice.listTemplates(); }
export async function listLatticePresets(c: RouterClient<AppRouter>, template: string, org?: string) { return c.lattice.listPresets({ template, org }); }
export async function listLatticeMinions(c: RouterClient<AppRouter>) { return c.lattice.listMinions(); }

// Name generation
export async function generateName(c: RouterClient<AppRouter>, message: string, candidates?: string[]) {
  return c.nameGeneration.generate({ message, candidates: candidates ?? [] });
}

// Telemetry
export async function getTelemetryStatus(c: RouterClient<AppRouter>) { return c.telemetry.status(); }

// Experiments
export async function getExperiments(c: RouterClient<AppRouter>) { return c.experiments.getAll(); }
export async function reloadExperiments(c: RouterClient<AppRouter>) { return c.experiments.reload(); }
