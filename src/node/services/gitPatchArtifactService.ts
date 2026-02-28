import * as path from "node:path";
import assert from "node:assert/strict";
import * as fsPromises from "fs/promises";

import type { Config } from "@/node/config";
import {
  coerceNonEmptyString,
  tryReadGitHeadCommitSha,
  findMinionEntry,
} from "@/node/services/taskUtils";
import { log } from "@/node/services/log";
import { readAgentDefinition } from "@/node/services/agentDefinitions/agentDefinitionsService";
import { resolveAgentInheritanceChain } from "@/node/services/agentDefinitions/resolveAgentInheritanceChain";
import { isExecLikeEditingCapableInResolvedChain } from "@/common/utils/agentTools";
import { createRuntimeForMinion } from "@/node/runtime/runtimeHelpers";
import { execBuffered } from "@/node/utils/runtime/helpers";
import { AgentIdSchema } from "@/common/orpc/schemas";
import {
  getSidekickGitPatchMboxPath,
  upsertSidekickGitPatchArtifact,
} from "@/node/services/sidekickGitPatchArtifacts";
import { shellQuote } from "@/common/utils/shell";
import { streamToString } from "@/node/runtime/streamUtils";
import { getErrorMessage } from "@/common/utils/errors";

/** Callback invoked after patch generation completes (success or failure). */
export type OnPatchGenerationComplete = (childMinionId: string) => Promise<void>;

async function writeReadableStreamToLocalFile(
  stream: ReadableStream<Uint8Array>,
  filePath: string
): Promise<void> {
  assert(filePath.length > 0, "writeReadableStreamToLocalFile: filePath must be non-empty");

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });

  const fileHandle = await fsPromises.open(filePath, "w");
  try {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await fileHandle.write(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    await fileHandle.close();
  }
}

// ---------------------------------------------------------------------------
// GitPatchArtifactService
// ---------------------------------------------------------------------------

/**
 * Handles git-format-patch artifact generation for sidekick tasks.
 *
 * Extracted from TaskService to keep patch-specific logic self-contained.
 */
export class GitPatchArtifactService {
  private readonly pendingJobsByTaskId = new Map<string, Promise<void>>();

  constructor(private readonly config: Config) {}

  /**
   * If the child minion is an exec-like agent, write a pending patch artifact
   * marker and kick off background `git format-patch` generation.
   *
   * @param onComplete - called after generation finishes (success *or* failure),
   *   typically used to trigger reported-leaf-task cleanup.
   */
  async maybeStartGeneration(
    parentMinionId: string,
    childMinionId: string,
    onComplete: OnPatchGenerationComplete
  ): Promise<void> {
    assert(
      parentMinionId.length > 0,
      "maybeStartGeneration: parentMinionId must be non-empty"
    );
    assert(childMinionId.length > 0, "maybeStartGeneration: childMinionId must be non-empty");

    const parentSessionDir = this.config.getSessionDir(parentMinionId);

    // Write a pending marker before we attempt cleanup, so the reported task minion isn't deleted
    // while we're still reading commits from it.
    const nowMs = Date.now();
    const cfg = this.config.loadConfigOrDefault();
    const childEntry = findMinionEntry(cfg, childMinionId);

    // Only exec-like sidekicks are expected to make commits that should be handed back to the parent.
    // NOTE: Custom agents can inherit from exec (base: exec). Those should also generate patches,
    // but read-only sidekicks (e.g. explore) should not.
    const childAgentIdRaw = coerceNonEmptyString(
      childEntry?.minion.agentId ?? childEntry?.minion.agentType
    );
    const childAgentId = childAgentIdRaw?.toLowerCase();
    if (!childAgentId) {
      return;
    }

    let shouldGeneratePatch = childAgentId === "exec";

    if (!shouldGeneratePatch) {
      const parsedChildAgentId = AgentIdSchema.safeParse(childAgentId);
      if (parsedChildAgentId.success) {
        const agentId = parsedChildAgentId.data;

        // Prefer resolving agent inheritance from the parent minion: project agents may be untracked
        // (and therefore absent from child worktrees), but they are always present in the parent that
        // spawned the task.
        const agentDiscoveryEntry = findMinionEntry(cfg, parentMinionId) ?? childEntry;
        const agentDiscoveryWs = agentDiscoveryEntry?.minion;

        const agentMinionPath = coerceNonEmptyString(agentDiscoveryWs?.path);
        const runtimeConfig = agentDiscoveryWs?.runtimeConfig;

        if (agentDiscoveryEntry && agentMinionPath && runtimeConfig) {
          const fallbackName =
            agentMinionPath.split("/").pop() ?? agentMinionPath.split("\\").pop() ?? "";
          const minionName =
            coerceNonEmptyString(agentDiscoveryWs?.name) ?? coerceNonEmptyString(fallbackName);

          if (minionName) {
            const runtime = createRuntimeForMinion({
              runtimeConfig,
              projectPath: agentDiscoveryEntry.projectPath,
              name: minionName,
            });

            try {
              const agentDefinition = await readAgentDefinition(
                runtime,
                agentMinionPath,
                agentId
              );
              const chain = await resolveAgentInheritanceChain({
                runtime,
                minionPath: agentMinionPath,
                agentId,
                agentDefinition,
                minionId: childMinionId,
              });

              shouldGeneratePatch = isExecLikeEditingCapableInResolvedChain(chain);
            } catch {
              // ignore - treat as non-exec-like
            }
          }
        }
      }
    }

    if (!shouldGeneratePatch) {
      return;
    }

    const baseCommitSha =
      coerceNonEmptyString(childEntry?.minion.taskBaseCommitSha) ?? undefined;

    const artifact = await upsertSidekickGitPatchArtifact({
      minionId: parentMinionId,
      minionSessionDir: parentSessionDir,
      childTaskId: childMinionId,
      updater: (existing) => {
        if (existing && existing.status !== "pending") {
          return existing;
        }

        return {
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "pending",
          baseCommitSha: baseCommitSha ?? existing?.baseCommitSha,
        };
      },
    });

    if (artifact.status !== "pending") {
      return;
    }

    if (this.pendingJobsByTaskId.has(childMinionId)) {
      return;
    }

    let job: Promise<void>;
    try {
      job = this.generate(parentMinionId, childMinionId, onComplete)
        .catch(async (error: unknown) => {
          log.error("Sidekick git patch generation failed", {
            parentMinionId,
            childMinionId,
            error,
          });

          // Best-effort: if generation failed before it could update the artifact status,
          // mark it failed so the parent isn't blocked forever by a pending marker.
          try {
            await upsertSidekickGitPatchArtifact({
              minionId: parentMinionId,
              minionSessionDir: parentSessionDir,
              childTaskId: childMinionId,
              updater: (existing) => {
                if (existing && existing.status !== "pending") {
                  return existing;
                }

                const failedAtMs = Date.now();
                return {
                  ...(existing ?? {}),
                  childTaskId: childMinionId,
                  parentMinionId,
                  createdAtMs: existing?.createdAtMs ?? failedAtMs,
                  updatedAtMs: failedAtMs,
                  status: "failed",
                  error: getErrorMessage(error),
                };
              },
            });
          } catch (updateError: unknown) {
            log.error("Failed to mark sidekick git patch artifact as failed", {
              parentMinionId,
              childMinionId,
              error: updateError,
            });
          }
        })
        .finally(() => {
          this.pendingJobsByTaskId.delete(childMinionId);
        });
    } catch (error: unknown) {
      // If scheduling fails synchronously, don't leave the artifact stuck in `pending`.
      await upsertSidekickGitPatchArtifact({
        minionId: parentMinionId,
        minionSessionDir: parentSessionDir,
        childTaskId: childMinionId,
        updater: (existing) => {
          if (existing && existing.status !== "pending") {
            return existing;
          }

          const failedAtMs = Date.now();
          return {
            ...(existing ?? {}),
            childTaskId: childMinionId,
            parentMinionId,
            createdAtMs: existing?.createdAtMs ?? failedAtMs,
            updatedAtMs: failedAtMs,
            status: "failed",
            error: getErrorMessage(error),
          };
        },
      });
      return;
    }

    this.pendingJobsByTaskId.set(childMinionId, job);
  }

  private async generate(
    parentMinionId: string,
    childMinionId: string,
    onComplete: OnPatchGenerationComplete
  ): Promise<void> {
    assert(parentMinionId.length > 0, "generate: parentMinionId must be non-empty");
    assert(childMinionId.length > 0, "generate: childMinionId must be non-empty");

    const parentSessionDir = this.config.getSessionDir(parentMinionId);

    const updateArtifact = async (
      updater: Parameters<typeof upsertSidekickGitPatchArtifact>[0]["updater"]
    ): Promise<void> => {
      await upsertSidekickGitPatchArtifact({
        minionId: parentMinionId,
        minionSessionDir: parentSessionDir,
        childTaskId: childMinionId,
        updater,
      });
    };

    const nowMs = Date.now();

    try {
      const cfg = this.config.loadConfigOrDefault();
      const entry = findMinionEntry(cfg, childMinionId);

      if (!entry) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          error: "Task minion not found in config.",
        }));
        return;
      }

      const ws = entry.minion;

      const minionPath = coerceNonEmptyString(ws.path);
      if (!minionPath) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          error: "Task minion path missing.",
        }));
        return;
      }

      if (!ws.runtimeConfig) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          error: "Task runtimeConfig missing.",
        }));
        return;
      }

      const fallbackName = minionPath.split("/").pop() ?? minionPath.split("\\").pop() ?? "";
      const minionName = coerceNonEmptyString(ws.name) ?? coerceNonEmptyString(fallbackName);
      if (!minionName) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          error: "Task minion name missing.",
        }));
        return;
      }

      const runtime = createRuntimeForMinion({
        runtimeConfig: ws.runtimeConfig,
        projectPath: entry.projectPath,
        name: minionName,
      });

      let baseCommitSha = coerceNonEmptyString(ws.taskBaseCommitSha);
      if (!baseCommitSha) {
        const trunkBranch =
          coerceNonEmptyString(ws.taskTrunkBranch) ??
          coerceNonEmptyString(findMinionEntry(cfg, parentMinionId)?.minion.name);

        if (!trunkBranch) {
          await updateArtifact((existing) => ({
            ...(existing ?? {}),
            childTaskId: childMinionId,
            parentMinionId,
            createdAtMs: existing?.createdAtMs ?? nowMs,
            updatedAtMs: nowMs,
            status: "failed",
            error:
              "taskBaseCommitSha missing and could not determine trunk branch for merge-base fallback.",
          }));
          return;
        }

        const mergeBaseResult = await execBuffered(
          runtime,
          `git merge-base ${shellQuote(trunkBranch)} HEAD`,
          { cwd: minionPath, timeout: 30 }
        );
        if (mergeBaseResult.exitCode !== 0) {
          await updateArtifact((existing) => ({
            ...(existing ?? {}),
            childTaskId: childMinionId,
            parentMinionId,
            createdAtMs: existing?.createdAtMs ?? nowMs,
            updatedAtMs: nowMs,
            status: "failed",
            error: `git merge-base failed: ${mergeBaseResult.stderr.trim() || "unknown error"}`,
          }));
          return;
        }

        baseCommitSha = mergeBaseResult.stdout.trim();
      }

      const headCommitSha = await tryReadGitHeadCommitSha(runtime, minionPath);
      if (!headCommitSha) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          error: "git rev-parse HEAD failed.",
        }));
        return;
      }

      const countResult = await execBuffered(
        runtime,
        `git rev-list --count ${baseCommitSha}..${headCommitSha}`,
        { cwd: minionPath, timeout: 30 }
      );
      if (countResult.exitCode !== 0) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          baseCommitSha,
          headCommitSha,
          error: `git rev-list failed: ${countResult.stderr.trim() || "unknown error"}`,
        }));
        return;
      }

      const commitCount = Number.parseInt(countResult.stdout.trim(), 10);
      if (!Number.isFinite(commitCount) || commitCount < 0) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "failed",
          baseCommitSha,
          headCommitSha,
          error: `Invalid commit count: ${countResult.stdout.trim()}`,
        }));
        return;
      }

      if (commitCount === 0) {
        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
          status: "skipped",
          baseCommitSha,
          headCommitSha,
          commitCount,
          error: undefined,
        }));
        return;
      }

      const patchPath = getSidekickGitPatchMboxPath(parentSessionDir, childMinionId);

      const formatPatchStream = await runtime.exec(
        `git format-patch --stdout --binary ${baseCommitSha}..${headCommitSha}`,
        { cwd: minionPath, timeout: 120 }
      );
      await formatPatchStream.stdin.close();

      const stderrPromise = streamToString(formatPatchStream.stderr);
      const writePromise = writeReadableStreamToLocalFile(formatPatchStream.stdout, patchPath);

      const [exitCode, stderr] = await Promise.all([
        formatPatchStream.exitCode,
        stderrPromise,
        writePromise,
      ]);

      if (exitCode !== 0) {
        // Leave no half-written patches around.
        await fsPromises.rm(patchPath, { force: true });

        await updateArtifact((existing) => ({
          ...(existing ?? {}),
          childTaskId: childMinionId,
          parentMinionId,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          updatedAtMs: Date.now(),
          status: "failed",
          baseCommitSha,
          headCommitSha,
          commitCount,
          error: `git format-patch failed (exitCode=${exitCode}): ${stderr.trim() || "unknown error"}`,
        }));
        return;
      }

      await updateArtifact((existing) => ({
        ...(existing ?? {}),
        childTaskId: childMinionId,
        parentMinionId,
        createdAtMs: existing?.createdAtMs ?? nowMs,
        updatedAtMs: Date.now(),
        status: "ready",
        baseCommitSha,
        headCommitSha,
        commitCount,
        mboxPath: patchPath,
        error: undefined,
      }));
    } catch (error: unknown) {
      await updateArtifact((existing) => ({
        ...(existing ?? {}),
        childTaskId: childMinionId,
        parentMinionId,
        createdAtMs: existing?.createdAtMs ?? nowMs,
        updatedAtMs: Date.now(),
        status: "failed",
        error: getErrorMessage(error),
      }));
    } finally {
      // Unblock auto-cleanup once the patch generation attempt has finished.
      await onComplete(childMinionId);
    }
  }
}
