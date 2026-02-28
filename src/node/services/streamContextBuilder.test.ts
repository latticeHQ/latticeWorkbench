import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, test } from "bun:test";

import { DEFAULT_RUNTIME_CONFIG } from "@/common/constants/minion";
import { sliceMessagesFromLatestCompactionBoundary } from "@/common/utils/messages/compactionBoundary";
import { createLatticeMessage } from "@/common/types/message";
import type { MinionMetadata } from "@/common/types/minion";
import { DEFAULT_TASK_SETTINGS } from "@/common/types/tasks";
import { getPlanFilePath } from "@/common/utils/planStorage";
import { LocalRuntime } from "@/node/runtime/LocalRuntime";
import { DisposableTempDir } from "@/node/services/tempDir";

import { buildPlanInstructions } from "./streamContextBuilder";

class TestRuntime extends LocalRuntime {
  constructor(
    projectPath: string,
    private readonly latticeHomePath: string
  ) {
    super(projectPath);
  }

  override getLatticeHome(): string {
    return this.latticeHomePath;
  }
}

describe("buildPlanInstructions", () => {
  test("uses request payload history for Start Here detection", async () => {
    using tempRoot = new DisposableTempDir("stream-context-builder");

    const projectPath = path.join(tempRoot.path, "project");
    const latticeHome = path.join(tempRoot.path, "lattice-home");
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(latticeHome, { recursive: true });

    const metadata: MinionMetadata = {
      id: "ws-1",
      name: "minion-1",
      projectName: "project-1",
      projectPath,
      runtimeConfig: DEFAULT_RUNTIME_CONFIG,
    };

    const runtime = new TestRuntime(projectPath, latticeHome);

    const planFilePath = getPlanFilePath(metadata.name, metadata.projectName, latticeHome);
    await fs.mkdir(path.dirname(planFilePath), { recursive: true });
    await fs.writeFile(planFilePath, "# Plan\n\n- Keep implementing", "utf-8");

    const startHereSummary = createLatticeMessage(
      "start-here",
      "assistant",
      "# Start Here\n\n- Existing plan context\n\n*Plan file preserved at:* /tmp/plan.md",
      {
        compacted: "user",
        agentId: "plan",
      }
    );

    const compactionBoundary = createLatticeMessage("boundary", "assistant", "Compacted summary", {
      compacted: "user",
      compactionBoundary: true,
      compactionEpoch: 1,
    });

    const latestUserMessage = createLatticeMessage("u1", "user", "continue implementation");

    const fullHistory = [startHereSummary, compactionBoundary, latestUserMessage];
    const requestPayloadMessages = sliceMessagesFromLatestCompactionBoundary(fullHistory);

    expect(requestPayloadMessages.map((message) => message.id)).toEqual(["boundary", "u1"]);

    const fromSlicedPayload = await buildPlanInstructions({
      runtime,
      metadata,
      minionId: metadata.id,
      minionPath: projectPath,
      effectiveMode: "exec",
      effectiveAgentId: "exec",
      agentIsPlanLike: false,
      agentDiscoveryPath: projectPath,
      additionalSystemInstructions: undefined,
      shouldDisableTaskToolsForDepth: false,
      taskDepth: 0,
      taskSettings: DEFAULT_TASK_SETTINGS,
      requestPayloadMessages,
    });

    const fromFullHistory = await buildPlanInstructions({
      runtime,
      metadata,
      minionId: metadata.id,
      minionPath: projectPath,
      effectiveMode: "exec",
      effectiveAgentId: "exec",
      agentIsPlanLike: false,
      agentDiscoveryPath: projectPath,
      additionalSystemInstructions: undefined,
      shouldDisableTaskToolsForDepth: false,
      taskDepth: 0,
      taskSettings: DEFAULT_TASK_SETTINGS,
      requestPayloadMessages: fullHistory,
    });

    expect(fromSlicedPayload.effectiveAdditionalInstructions).toContain(
      `A plan file exists at: ${fromSlicedPayload.planFilePath}`
    );
    expect(fromFullHistory.effectiveAdditionalInstructions).toBeUndefined();
  });
});
