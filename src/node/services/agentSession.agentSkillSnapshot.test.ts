import { describe, expect, it, mock, afterEach, spyOn } from "bun:test";
import { EventEmitter } from "events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { AIService } from "@/node/services/aiService";
import type { InitStateManager } from "@/node/services/initStateManager";
import type { BackgroundProcessManager } from "@/node/services/backgroundProcessManager";
import type { Config } from "@/node/config";

import type { FrontendMinionMetadata } from "@/common/types/minion";
import { createLatticeMessage, type LatticeMessage } from "@/common/types/message";
import type { SendMessageError } from "@/common/types/errors";
import type { Result } from "@/common/types/result";
import { Ok } from "@/common/types/result";

import { AgentSession } from "./agentSession";
import { createTestHistoryService } from "./testHistoryService";

describe("AgentSession.sendMessage (agent skill snapshots)", () => {
  async function createTestMinionWithSkill(args: { skillName: string; skillBody: string }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-agent-skill-"));
    const skillDir = path.join(tmp, ".lattice", "skills", args.skillName);
    await fs.mkdir(skillDir, { recursive: true });

    const skillMarkdown = `---\nname: ${args.skillName}\ndescription: Test skill\n---\n\n${args.skillBody}\n`;
    await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMarkdown, "utf-8");

    return { minionPath: tmp };
  }

  let historyCleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await historyCleanup?.();
  });

  it("persists a synthetic agent skill snapshot before the user message", async () => {
    const minionId = "ws-test";

    const { minionPath } = await createTestMinionWithSkill({
      skillName: "test-skill",
      skillBody: "Follow this skill.",
    });

    const config = {
      srcDir: "/tmp",
      getSessionDir: (_minionId: string) => "/tmp",
    } as unknown as Config;

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;

    const messages: LatticeMessage[] = [];
    const realAppend = historyService.appendToHistory.bind(historyService);
    const appendToHistory = spyOn(historyService, "appendToHistory").mockImplementation(
      async (wId: string, message: LatticeMessage) => {
        messages.push(message);
        return realAppend(wId, message);
      }
    );

    const aiEmitter = new EventEmitter();

    const minionMeta: FrontendMinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath: minionPath,
      namedMinionPath: minionPath,
      runtimeConfig: { type: "local" },
    } as unknown as FrontendMinionMetadata;

    const streamMessage = mock((_messages: LatticeMessage[]) => {
      return Promise.resolve(Ok(undefined));
    });

    const aiService = Object.assign(aiEmitter, {
      isStreaming: mock((_minionId: string) => false),
      stopStream: mock((_minionId: string) => Promise.resolve(Ok(undefined))),
      getMinionMetadata: mock((_minionId: string) => Promise.resolve(Ok(minionMeta))),
      streamMessage: streamMessage as unknown as (
        ...args: Parameters<AIService["streamMessage"]>
      ) => Promise<Result<void, SendMessageError>>,
    }) as unknown as AIService;

    const initStateManager = new EventEmitter() as unknown as InitStateManager;

    const backgroundProcessManager = {
      cleanup: mock((_minionId: string) => Promise.resolve()),
      setMessageQueued: mock((_minionId: string, _queued: boolean) => {
        void _queued;
      }),
    } as unknown as BackgroundProcessManager;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const result = await session.sendMessage("do X", {
      model: "anthropic:claude-3-5-sonnet-latest",
      agentId: "exec",
      latticeMetadata: {
        type: "agent-skill",
        rawCommand: "/test-skill do X",
        skillName: "test-skill",
        scope: "project",
      },
    });

    expect(result.success).toBe(true);

    expect(appendToHistory.mock.calls).toHaveLength(2);
    const [snapshotMessage, userMessage] = messages;

    expect(snapshotMessage.role).toBe("user");
    expect(snapshotMessage.metadata?.synthetic).toBe(true);
    expect(snapshotMessage.metadata?.agentSkillSnapshot?.skillName).toBe("test-skill");
    expect(snapshotMessage.metadata?.agentSkillSnapshot?.sha256).toBeTruthy();

    const frontmatterYaml = snapshotMessage.metadata?.agentSkillSnapshot?.frontmatterYaml;
    expect(frontmatterYaml).toBeTruthy();
    expect(frontmatterYaml ?? "").toContain("name:");
    expect(frontmatterYaml ?? "").toContain("description:");

    const snapshotText = snapshotMessage.parts.find((p) => p.type === "text")?.text;
    expect(snapshotText).toContain("<agent-skill");
    expect(snapshotText).toContain("Follow this skill.");

    expect(userMessage.role).toBe("user");
    const userText = userMessage.parts.find((p) => p.type === "text")?.text;
    expect(userText).toBe("do X");
  });

  it("honors disableMinionAgents when resolving skill snapshots", async () => {
    const minionId = "ws-test";

    const { minionPath: projectPath } = await createTestMinionWithSkill({
      // Built-in: use a project-local override to ensure we don't accidentally fall back.
      skillName: "init",
      skillBody: "Project override for init skill.",
    });

    const srcBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-agent-skill-src-"));

    const config = {
      srcDir: "/tmp",
      getSessionDir: (_minionId: string) => "/tmp",
    } as unknown as Config;

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;

    const messages: LatticeMessage[] = [];
    const realAppend = historyService.appendToHistory.bind(historyService);
    const appendToHistory = spyOn(historyService, "appendToHistory").mockImplementation(
      async (wId: string, message: LatticeMessage) => {
        messages.push(message);
        return realAppend(wId, message);
      }
    );

    const aiEmitter = new EventEmitter();

    const minionMeta: FrontendMinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath,
      namedMinionPath: projectPath,
      runtimeConfig: { type: "worktree", srcBaseDir },
    } as unknown as FrontendMinionMetadata;

    const streamMessage = mock((_messages: LatticeMessage[]) => {
      return Promise.resolve(Ok(undefined));
    });

    const aiService = Object.assign(aiEmitter, {
      isStreaming: mock((_minionId: string) => false),
      stopStream: mock((_minionId: string) => Promise.resolve(Ok(undefined))),
      getMinionMetadata: mock((_minionId: string) => Promise.resolve(Ok(minionMeta))),
      streamMessage: streamMessage as unknown as (
        ...args: Parameters<AIService["streamMessage"]>
      ) => Promise<Result<void, SendMessageError>>,
    }) as unknown as AIService;

    const initStateManager = new EventEmitter() as unknown as InitStateManager;

    const backgroundProcessManager = {
      cleanup: mock((_minionId: string) => Promise.resolve()),
      setMessageQueued: mock((_minionId: string, _queued: boolean) => {
        void _queued;
      }),
    } as unknown as BackgroundProcessManager;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const result = await session.sendMessage("do X", {
      model: "anthropic:claude-3-5-sonnet-latest",
      agentId: "exec",
      disableMinionAgents: true,
      latticeMetadata: {
        type: "agent-skill",
        rawCommand: "/init",
        skillName: "init",
        scope: "project",
      },
    });

    expect(result.success).toBe(true);

    expect(appendToHistory.mock.calls).toHaveLength(2);
    const [snapshotMessage] = messages;

    const snapshotText = snapshotMessage.parts.find((p) => p.type === "text")?.text;
    expect(snapshotText).toContain("Project override for init skill.");
  });

  it("dedupes identical skill snapshots when recently inserted", async () => {
    const minionId = "ws-test";

    const { minionPath } = await createTestMinionWithSkill({
      skillName: "test-skill",
      skillBody: "Follow this skill.",
    });

    const config = {
      srcDir: "/tmp",
      getSessionDir: (_minionId: string) => "/tmp",
    } as unknown as Config;

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;

    const messages: LatticeMessage[] = [];
    const realAppend = historyService.appendToHistory.bind(historyService);
    const appendToHistory = spyOn(historyService, "appendToHistory").mockImplementation(
      async (wId: string, message: LatticeMessage) => {
        messages.push(message);
        return realAppend(wId, message);
      }
    );

    const aiEmitter = new EventEmitter();

    const minionMeta: FrontendMinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath: minionPath,
      namedMinionPath: minionPath,
      runtimeConfig: { type: "local" },
    } as unknown as FrontendMinionMetadata;

    const streamMessage = mock((_messages: LatticeMessage[]) => {
      return Promise.resolve(Ok(undefined));
    });

    const aiService = Object.assign(aiEmitter, {
      isStreaming: mock((_minionId: string) => false),
      stopStream: mock((_minionId: string) => Promise.resolve(Ok(undefined))),
      getMinionMetadata: mock((_minionId: string) => Promise.resolve(Ok(minionMeta))),
      streamMessage: streamMessage as unknown as (
        ...args: Parameters<AIService["streamMessage"]>
      ) => Promise<Result<void, SendMessageError>>,
    }) as unknown as AIService;

    const initStateManager = new EventEmitter() as unknown as InitStateManager;

    const backgroundProcessManager = {
      cleanup: mock((_minionId: string) => Promise.resolve()),
      setMessageQueued: mock((_minionId: string, _queued: boolean) => {
        void _queued;
      }),
    } as unknown as BackgroundProcessManager;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const baseOptions = {
      model: "anthropic:claude-3-5-sonnet-latest",
      agentId: "exec",
      latticeMetadata: {
        type: "agent-skill",
        rawCommand: "/test-skill do X",
        skillName: "test-skill",
        scope: "project",
      },
    };

    const first = await session.sendMessage("do X", baseOptions);
    expect(first.success).toBe(true);
    expect(appendToHistory.mock.calls).toHaveLength(2);

    const second = await session.sendMessage("do Y", {
      ...baseOptions,
      latticeMetadata: {
        ...baseOptions.latticeMetadata,
        rawCommand: "/test-skill do Y",
      },
    });

    expect(second.success).toBe(true);
    // First send: snapshot + user. Second send: user only.
    expect(appendToHistory.mock.calls).toHaveLength(3);

    const appendedIds = appendToHistory.mock.calls.map((call) => call[1].id);
    const secondSendAppendedIds = appendedIds.slice(2);
    expect(secondSendAppendedIds).toHaveLength(1);
    expect(secondSendAppendedIds[0]).toStartWith("user-");
  });

  it("persists a new skill snapshot when frontmatter changes (body unchanged)", async () => {
    const minionId = "ws-test";

    const skillName = "test-skill";
    const skillBody = "Follow this skill.";

    const { minionPath } = await createTestMinionWithSkill({
      skillName,
      skillBody,
    });

    const config = {
      srcDir: "/tmp",
      getSessionDir: (_minionId: string) => "/tmp",
    } as unknown as Config;

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;

    const messages: LatticeMessage[] = [];
    const realAppend = historyService.appendToHistory.bind(historyService);
    const appendToHistory = spyOn(historyService, "appendToHistory").mockImplementation(
      async (wId: string, message: LatticeMessage) => {
        messages.push(message);
        return realAppend(wId, message);
      }
    );

    const aiEmitter = new EventEmitter();

    const minionMeta: FrontendMinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath: minionPath,
      namedMinionPath: minionPath,
      runtimeConfig: { type: "local" },
    } as unknown as FrontendMinionMetadata;

    const aiService = Object.assign(aiEmitter, {
      isStreaming: mock((_minionId: string) => false),
      stopStream: mock((_minionId: string) => Promise.resolve(Ok(undefined))),
      getMinionMetadata: mock((_minionId: string) => Promise.resolve(Ok(minionMeta))),
      streamMessage: mock((_messages: LatticeMessage[]) => {
        return Promise.resolve(Ok(undefined));
      }) as unknown as (
        ...args: Parameters<AIService["streamMessage"]>
      ) => Promise<Result<void, SendMessageError>>,
    }) as unknown as AIService;

    const initStateManager = new EventEmitter() as unknown as InitStateManager;

    const backgroundProcessManager = {
      cleanup: mock((_minionId: string) => Promise.resolve()),
      setMessageQueued: mock((_minionId: string, _queued: boolean) => {
        void _queued;
      }),
    } as unknown as BackgroundProcessManager;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const baseOptions = {
      model: "anthropic:claude-3-5-sonnet-latest",
      agentId: "exec",
      latticeMetadata: {
        type: "agent-skill",
        rawCommand: "/test-skill do X",
        skillName,
        scope: "project",
      },
    };

    const first = await session.sendMessage("do X", baseOptions);
    expect(first.success).toBe(true);
    expect(appendToHistory.mock.calls).toHaveLength(2);

    const firstSnapshot = messages[0];
    expect(firstSnapshot.id).toStartWith("agent-skill-snapshot-");

    const firstSnapshotText = firstSnapshot.parts.find((p) => p.type === "text")?.text;
    expect(firstSnapshotText).toBeTruthy();

    const firstSha = firstSnapshot.metadata?.agentSkillSnapshot?.sha256;
    expect(firstSha).toBeTruthy();

    // Update frontmatter only.
    const skillFilePath = path.join(minionPath, ".lattice", "skills", skillName, "SKILL.md");
    const updatedSkillMarkdown = `---\nname: ${skillName}\ndescription: Updated description\n---\n\n${skillBody}\n`;
    await fs.writeFile(skillFilePath, updatedSkillMarkdown, "utf-8");

    const second = await session.sendMessage("do Y", {
      ...baseOptions,
      latticeMetadata: {
        ...baseOptions.latticeMetadata,
        rawCommand: "/test-skill do Y",
      },
    });

    expect(second.success).toBe(true);

    // Second send should persist a new snapshot (frontmatter differs) + user message.
    expect(appendToHistory.mock.calls).toHaveLength(4);

    const secondSnapshot = messages[2];
    expect(secondSnapshot.id).toStartWith("agent-skill-snapshot-");

    const secondSnapshotText = secondSnapshot.parts.find((p) => p.type === "text")?.text;
    expect(secondSnapshotText).toBe(firstSnapshotText);

    const secondSha = secondSnapshot.metadata?.agentSkillSnapshot?.sha256;
    expect(secondSha).toBeTruthy();
    expect(secondSha).not.toBe(firstSha);

    const secondFrontmatter = secondSnapshot.metadata?.agentSkillSnapshot?.frontmatterYaml;
    expect(secondFrontmatter ?? "").toContain("Updated description");
  });

  it("truncates edits starting from preceding skill/file snapshots", async () => {
    const minionId = "ws-test";

    const config = {
      srcDir: "/tmp",
      getSessionDir: (_minionId: string) => "/tmp",
    } as unknown as Config;

    const fileSnapshotId = "file-snapshot-0";
    const skillSnapshotId = "agent-skill-snapshot-0";
    const userMessageId = "user-0";

    const historyMessages: LatticeMessage[] = [
      createLatticeMessage(fileSnapshotId, "user", "<file>...</file>", {
        historySequence: 0,
        synthetic: true,
        fileAtMentionSnapshot: ["@file:foo.txt"],
      }),
      createLatticeMessage(skillSnapshotId, "user", "<agent-skill>...</agent-skill>", {
        historySequence: 1,
        synthetic: true,
        agentSkillSnapshot: {
          skillName: "test-skill",
          scope: "project",
          sha256: "abc",
        },
      }),
      createLatticeMessage(userMessageId, "user", "do X", {
        historySequence: 2,
        latticeMetadata: {
          type: "agent-skill",
          rawCommand: "/test-skill do X",
          skillName: "test-skill",
          scope: "project",
        },
      }),
    ];

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;

    // Seed history messages before setting up spies
    for (const msg of historyMessages) {
      await historyService.appendToHistory(minionId, msg);
    }

    const truncateAfterMessage = spyOn(historyService, "truncateAfterMessage");
    spyOn(historyService, "appendToHistory");

    const aiEmitter = new EventEmitter();
    const aiService = Object.assign(aiEmitter, {
      isStreaming: mock((_minionId: string) => false),
      stopStream: mock((_minionId: string) => Promise.resolve(Ok(undefined))),
      streamMessage: mock((_messages: LatticeMessage[]) =>
        Promise.resolve(Ok(undefined))
      ) as unknown as (
        ...args: Parameters<AIService["streamMessage"]>
      ) => Promise<Result<void, SendMessageError>>,
    }) as unknown as AIService;

    const initStateManager = new EventEmitter() as unknown as InitStateManager;

    const backgroundProcessManager = {
      cleanup: mock((_minionId: string) => Promise.resolve()),
      setMessageQueued: mock((_minionId: string, _queued: boolean) => {
        void _queued;
      }),
    } as unknown as BackgroundProcessManager;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const result = await session.sendMessage("edited", {
      model: "anthropic:claude-3-5-sonnet-latest",
      agentId: "exec",
      editMessageId: userMessageId,
    });

    expect(result.success).toBe(true);
    expect(truncateAfterMessage.mock.calls).toHaveLength(1);
    // Should truncate from the earliest contiguous snapshot (file snapshot).
    expect(truncateAfterMessage.mock.calls[0][1]).toBe(fileSnapshotId);
  });
});
