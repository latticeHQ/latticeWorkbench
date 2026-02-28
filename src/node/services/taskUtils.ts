/**
 * Small pure helpers shared by TaskService and GitPatchArtifactService.
 * Extracted to a standalone module to avoid circular imports.
 */
import assert from "node:assert/strict";
import type { Config, Minion as MinionConfigEntry } from "@/node/config";
import type { Runtime } from "@/node/runtime/Runtime";
import { execBuffered } from "@/node/utils/runtime/helpers";

export function coerceNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function tryReadGitHeadCommitSha(
  runtime: Runtime,
  minionPath: string
): Promise<string | undefined> {
  assert(minionPath.length > 0, "tryReadGitHeadCommitSha: minionPath must be non-empty");

  try {
    const result = await execBuffered(runtime, "git rev-parse HEAD", {
      cwd: minionPath,
      timeout: 10,
    });
    if (result.exitCode !== 0) {
      return undefined;
    }

    const sha = result.stdout.trim();
    return sha.length > 0 ? sha : undefined;
  } catch {
    return undefined;
  }
}

export function findMinionEntry(
  config: ReturnType<Config["loadConfigOrDefault"]>,
  minionId: string
): { projectPath: string; minion: MinionConfigEntry } | null {
  for (const [projectPath, project] of config.projects) {
    for (const minion of project.minions) {
      if (minion.id === minionId) {
        return { projectPath, minion };
      }
    }
  }
  return null;
}

/**
 * Walk the parentMinionId chain to compute task nesting depth.
 * Detects cycles (max 32 hops).
 */
export function getTaskDepthFromConfig(
  config: ReturnType<Config["loadConfigOrDefault"]>,
  minionId: string
): number {
  const parentById = new Map<string, string | undefined>();
  for (const project of config.projects.values()) {
    for (const minion of project.minions) {
      if (!minion.id) continue;
      parentById.set(minion.id, minion.parentMinionId);
    }
  }

  let depth = 0;
  let current = minionId;
  for (let i = 0; i < 32; i++) {
    const parent = parentById.get(current);
    if (!parent) break;
    depth += 1;
    current = parent;
  }

  if (depth >= 32) {
    throw new Error(
      `getTaskDepthFromConfig: possible parentMinionId cycle starting at ${minionId}`
    );
  }

  return depth;
}
