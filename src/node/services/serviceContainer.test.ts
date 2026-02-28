import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  LATTICE_HELP_CHAT_AGENT_ID,
  LATTICE_HELP_CHAT_MINION_ID,
  LATTICE_HELP_CHAT_MINION_NAME,
  LATTICE_HELP_CHAT_MINION_TITLE,
} from "@/common/constants/latticeChat";
import { getLatticeHelpChatProjectPath } from "@/node/constants/latticeChat";
import { Config } from "@/node/config";
import { ServiceContainer } from "./serviceContainer";

describe("ServiceContainer", () => {
  let tempDir: string;
  let config: Config;
  let services: ServiceContainer | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-service-container-test-"));
    config = new Config(tempDir);
  });

  afterEach(async () => {
    if (services) {
      await services.dispose();
      await services.shutdown();
      services = undefined;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes stale lattice-chat entries from other roots and keeps exactly one active system minion", async () => {
    const activeProjectPath = getLatticeHelpChatProjectPath(config.rootDir);
    const staleProjectPath = path.join(`${config.rootDir}-legacy`, "system", "Lattice");

    await config.editConfig((cfg) => {
      cfg.projects.set(activeProjectPath, {
        minions: [
          {
            path: activeProjectPath,
            id: LATTICE_HELP_CHAT_MINION_ID,
            name: "wrong-name",
            title: "Wrong Title",
            agentId: "not-lattice",
            createdAt: "2026-01-01T00:00:00.000Z",
            runtimeConfig: { type: "local" },
            archivedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            path: activeProjectPath,
            id: LATTICE_HELP_CHAT_MINION_ID,
            name: "duplicate",
            title: "Duplicate",
            agentId: LATTICE_HELP_CHAT_AGENT_ID,
            createdAt: "2026-01-03T00:00:00.000Z",
            runtimeConfig: { type: "local" },
          },
        ],
      });
      cfg.projects.set(staleProjectPath, {
        minions: [
          {
            path: staleProjectPath,
            id: LATTICE_HELP_CHAT_MINION_ID,
            name: LATTICE_HELP_CHAT_MINION_NAME,
            title: LATTICE_HELP_CHAT_MINION_TITLE,
            agentId: LATTICE_HELP_CHAT_AGENT_ID,
            createdAt: "2026-01-04T00:00:00.000Z",
            runtimeConfig: { type: "local" },
          },
        ],
      });
      return cfg;
    });

    services = new ServiceContainer(config);
    await services.initialize();

    const loaded = config.loadConfigOrDefault();
    expect(loaded.projects.has(staleProjectPath)).toBe(false);

    const latticeChatEntries = Array.from(loaded.projects.values())
      .flatMap((project) => project.minions)
      .filter((minion) => minion.id === LATTICE_HELP_CHAT_MINION_ID);

    expect(latticeChatEntries).toHaveLength(1);

    const activeProject = loaded.projects.get(activeProjectPath);
    expect(activeProject).toBeDefined();
    expect(activeProject?.minions).toHaveLength(1);

    const latticeChatMinion = activeProject?.minions[0];
    expect(latticeChatMinion?.path).toBe(activeProjectPath);
    expect(latticeChatMinion?.id).toBe(LATTICE_HELP_CHAT_MINION_ID);
    expect(latticeChatMinion?.name).toBe(LATTICE_HELP_CHAT_MINION_NAME);
    expect(latticeChatMinion?.title).toBe(LATTICE_HELP_CHAT_MINION_TITLE);
    expect(latticeChatMinion?.agentId).toBe(LATTICE_HELP_CHAT_AGENT_ID);
    expect(latticeChatMinion?.runtimeConfig).toEqual({ type: "local" });
    expect(latticeChatMinion?.archivedAt).toBeUndefined();
    expect(latticeChatMinion?.unarchivedAt).toBeUndefined();
  });

  it("keeps non-system legacy minions whose IDs also equal lattice-chat", async () => {
    const legacyProjectPath = path.join(tempDir, "repos", "lattice");
    const legacyMinionPath = path.join(config.srcDir, "lattice", "chat");

    await config.editConfig((cfg) => {
      cfg.projects.set(legacyProjectPath, {
        minions: [
          {
            path: legacyMinionPath,
            id: LATTICE_HELP_CHAT_MINION_ID,
            name: "chat",
            title: "Legacy Chat Branch",
            runtimeConfig: { type: "local" },
          },
        ],
      });
      return cfg;
    });

    services = new ServiceContainer(config);
    await services.initialize();

    const loaded = config.loadConfigOrDefault();
    const legacyProject = loaded.projects.get(legacyProjectPath);

    expect(legacyProject).toBeDefined();
    expect(legacyProject?.minions).toHaveLength(1);
    expect(legacyProject?.minions[0].id).toBe(LATTICE_HELP_CHAT_MINION_ID);
    expect(legacyProject?.minions[0].path).toBe(legacyMinionPath);

    const activeSystemProject = loaded.projects.get(getLatticeHelpChatProjectPath(config.rootDir));
    expect(activeSystemProject).toBeDefined();
    expect(
      activeSystemProject?.minions.some(
        (minion) => minion.id === LATTICE_HELP_CHAT_MINION_ID
      )
    ).toBe(true);
  });
});
