import type { FrontendMinionMetadata } from "@/common/types/minion";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import type { MinionContext } from "./MinionContext";
import { MinionProvider, useMinionContext } from "./MinionContext";
import { ProjectProvider } from "@/browser/contexts/ProjectContext";
import { RouterProvider } from "@/browser/contexts/RouterContext";
import { useMinionStoreRaw as getMinionStoreRaw } from "@/browser/stores/MinionStore";
import {
  SELECTED_MINION_KEY,
  getModelKey,
  getWorkbenchPanelLayoutKey,
  getTerminalTitlesKey,
  getThinkingLevelKey,
} from "@/common/constants/storage";
import type { RecursivePartial } from "@/browser/testUtils";
import { readPersistedState } from "@/browser/hooks/usePersistedState";
import type { WorkbenchPanelLayoutState } from "@/browser/utils/workbenchPanelLayout";

import type { APIClient } from "@/browser/contexts/API";

// Mock API
let currentClientMock: RecursivePartial<APIClient> = {};
void mock.module("@/browser/contexts/API", () => ({
  useAPI: () => ({
    api: currentClientMock as APIClient,
    status: "connected" as const,
    error: null,
  }),
  APIProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Helper to create test minion metadata with default runtime config
const createMinionMetadata = (
  overrides: Partial<FrontendMinionMetadata> & Pick<FrontendMinionMetadata, "id">
): FrontendMinionMetadata => ({
  projectPath: "/test",
  projectName: "test",
  name: "main",
  namedMinionPath: "/test-main",
  createdAt: "2025-01-01T00:00:00.000Z",
  runtimeConfig: { type: "local", srcBaseDir: "/home/user/.lattice/src" },
  ...overrides,
});

describe("MinionContext", () => {
  afterEach(() => {
    cleanup();

    // Reset global minion store to avoid cross-test leakage
    getMinionStoreRaw().dispose();

    globalThis.window = undefined as unknown as Window & typeof globalThis;
    globalThis.document = undefined as unknown as Document;
    globalThis.localStorage = undefined as unknown as Storage;

    currentClientMock = {};
  });

  test("syncs minion store subscriptions when metadata loads", async () => {
    const initialMinions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: "ws-sync-load",
        projectPath: "/alpha",
        projectName: "alpha",
        name: "main",
        namedMinionPath: "/alpha-main",
      }),
    ];

    const { minion: minionApi } = createMockAPI({
      minion: {
        list: () => Promise.resolve(initialMinions),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));

    // Activate the minion so onChat subscription starts (required after the
    // refactor that scoped onChat to the active minion only).
    act(() => {
      getMinionStoreRaw().setActiveMinionId("ws-sync-load");
    });

    await waitFor(() =>
      expect(
        minionApi.onChat.mock.calls.some(
          ([{ minionId }]: [{ minionId: string }, ...unknown[]]) =>
            minionId === "ws-sync-load"
        )
      ).toBe(true)
    );
  });

  test("subscribes to new minion immediately when metadata event fires", async () => {
    const { minion: minionApi } = createMockAPI({
      minion: {
        list: () => Promise.resolve([]),
      },
    });

    await setup();

    await waitFor(() => expect(minionApi.onMetadata.mock.calls.length).toBeGreaterThan(0));
    expect(minionApi.onMetadata).toHaveBeenCalled();
  });

  test("switches selection to parent when selected child minion is deleted", async () => {
    const parentId = "ws-parent";
    const childId = "ws-child";

    const minions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: parentId,
        projectPath: "/alpha",
        projectName: "alpha",
        name: "main",
        namedMinionPath: "/alpha-main",
      }),
      createMinionMetadata({
        id: childId,
        projectPath: "/alpha",
        projectName: "alpha",
        name: "agent_explore_ws-child",
        namedMinionPath: "/alpha-agent",
        parentMinionId: parentId,
      }),
    ];

    let emitDelete:
      | ((event: { minionId: string; metadata: FrontendMinionMetadata | null }) => void)
      | null = null;

    const { minion: minionApi } = createMockAPI({
      minion: {
        list: () => Promise.resolve(minions),
        onMetadata: () =>
          Promise.resolve(
            (async function* () {
              const event = await new Promise<{
                minionId: string;
                metadata: FrontendMinionMetadata | null;
              }>((resolve) => {
                emitDelete = resolve;
              });
              yield event;
            })() as unknown as Awaited<ReturnType<APIClient["minion"]["onMetadata"]>>
          ),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
      localStorage: {
        [SELECTED_MINION_KEY]: JSON.stringify({
          minionId: childId,
          projectPath: "/alpha",
          projectName: "alpha",
          namedMinionPath: "/alpha-agent",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(2));
    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe(childId));
    await waitFor(() => expect(minionApi.onMetadata).toHaveBeenCalled());
    await waitFor(() => expect(emitDelete).toBeTruthy());

    act(() => {
      emitDelete?.({ minionId: childId, metadata: null });
    });

    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe(parentId));
  });

  test("navigates to project page when selected minion is archived", async () => {
    const minionId = "ws-archive";
    const projectPath = "/alpha";

    const minions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: minionId,
        projectPath,
        projectName: "alpha",
        name: "main",
        namedMinionPath: "/alpha-main",
      }),
    ];

    let emitArchive:
      | ((event: { minionId: string; metadata: FrontendMinionMetadata | null }) => void)
      | null = null;

    createMockAPI({
      minion: {
        list: () => Promise.resolve(minions),
        onMetadata: () =>
          Promise.resolve(
            (async function* () {
              const event = await new Promise<{
                minionId: string;
                metadata: FrontendMinionMetadata | null;
              }>((resolve) => {
                emitArchive = resolve;
              });
              yield event;
            })() as unknown as Awaited<ReturnType<APIClient["minion"]["onMetadata"]>>
          ),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
      localStorage: {
        [SELECTED_MINION_KEY]: JSON.stringify({
          minionId,
          projectPath,
          projectName: "alpha",
          namedMinionPath: "/alpha-main",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe(minionId));
    await waitFor(() => expect(emitArchive).toBeTruthy());

    act(() => {
      emitArchive?.({
        minionId,
        metadata: createMinionMetadata({
          id: minionId,
          projectPath,
          projectName: "alpha",
          name: "main",
          namedMinionPath: "/alpha-main",
          archivedAt: "2025-02-01T00:00:00.000Z",
        }),
      });
    });

    await waitFor(() => expect(ctx().pendingNewMinionProject).toBe(projectPath));
    expect(ctx().selectedMinion).toBeNull();
    await waitFor(() => expect(ctx().minionMetadata.has(minionId)).toBe(false));
    expect(localStorage.getItem(SELECTED_MINION_KEY)).toBeNull();
  });

  test("archiving does not override a rapid manual minion switch", async () => {
    const archivedId = "ws-archive-old";
    const nextId = "ws-keep";

    const minions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: archivedId,
        projectPath: "/alpha",
        projectName: "alpha",
        name: "main",
        namedMinionPath: "/alpha-main",
      }),
      createMinionMetadata({
        id: nextId,
        projectPath: "/beta",
        projectName: "beta",
        name: "main",
        namedMinionPath: "/beta-main",
      }),
    ];

    let emitArchive:
      | ((event: { minionId: string; metadata: FrontendMinionMetadata | null }) => void)
      | null = null;

    createMockAPI({
      minion: {
        list: () => Promise.resolve(minions),
        onMetadata: () =>
          Promise.resolve(
            (async function* () {
              const event = await new Promise<{
                minionId: string;
                metadata: FrontendMinionMetadata | null;
              }>((resolve) => {
                emitArchive = resolve;
              });
              yield event;
            })() as unknown as Awaited<ReturnType<APIClient["minion"]["onMetadata"]>>
          ),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
      localStorage: {
        [SELECTED_MINION_KEY]: JSON.stringify({
          minionId: archivedId,
          projectPath: "/alpha",
          projectName: "alpha",
          namedMinionPath: "/alpha-main",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe(archivedId));
    await waitFor(() => expect(emitArchive).toBeTruthy());

    const nextSelection = {
      minionId: nextId,
      projectPath: "/beta",
      projectName: "beta",
      namedMinionPath: "/beta-main",
    };

    // Simulate a fast user click to switch minions while the archive event is in flight.
    // The metadata handler must not navigate to the project page after this intent.
    act(() => {
      ctx().setSelectedMinion(nextSelection);
      emitArchive?.({
        minionId: archivedId,
        metadata: createMinionMetadata({
          id: archivedId,
          projectPath: "/alpha",
          projectName: "alpha",
          name: "main",
          namedMinionPath: "/alpha-main",
          archivedAt: "2025-02-01T00:00:00.000Z",
        }),
      });
    });

    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe(nextId));
    expect(ctx().pendingNewMinionProject).toBeNull();
    await waitFor(() => expect(ctx().minionMetadata.has(archivedId)).toBe(false));
    expect(localStorage.getItem(SELECTED_MINION_KEY)).toContain(nextId);
  });

  test("removes non-selected child minion from metadata map when deleted", async () => {
    // Bug regression: when a sidekick minion is deleted while not selected,
    // it was staying in the metadata map due to early return in the handler.
    const parentId = "ws-parent";
    const childId = "ws-child";

    const minions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: parentId,
        projectPath: "/alpha",
        projectName: "alpha",
        name: "main",
        namedMinionPath: "/alpha-main",
      }),
      createMinionMetadata({
        id: childId,
        projectPath: "/alpha",
        projectName: "alpha",
        name: "agent_explore_ws-child",
        namedMinionPath: "/alpha-agent",
        parentMinionId: parentId,
      }),
    ];

    let emitDelete:
      | ((event: { minionId: string; metadata: FrontendMinionMetadata | null }) => void)
      | null = null;

    createMockAPI({
      minion: {
        list: () => Promise.resolve(minions),
        onMetadata: () =>
          Promise.resolve(
            (async function* () {
              const event = await new Promise<{
                minionId: string;
                metadata: FrontendMinionMetadata | null;
              }>((resolve) => {
                emitDelete = resolve;
              });
              yield event;
            })() as unknown as Awaited<ReturnType<APIClient["minion"]["onMetadata"]>>
          ),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
      // Parent is selected, not the child
      localStorage: {
        [SELECTED_MINION_KEY]: JSON.stringify({
          minionId: parentId,
          projectPath: "/alpha",
          projectName: "alpha",
          namedMinionPath: "/alpha-main",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(2));
    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe(parentId));
    await waitFor(() => expect(emitDelete).toBeTruthy());

    // Delete the non-selected child minion
    act(() => {
      emitDelete?.({ minionId: childId, metadata: null });
    });

    // Child should be removed from metadata map (this was the bug - it stayed)
    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));
    expect(ctx().minionMetadata.has(childId)).toBe(false);
    // Parent should still be selected
    expect(ctx().selectedMinion?.minionId).toBe(parentId);
  });

  test("seeds model + thinking localStorage from backend metadata", async () => {
    const initialMinions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: "ws-ai",
        aiSettings: { model: "openai:gpt-5.2", thinkingLevel: "xhigh" },
      }),
    ];

    createMockAPI({
      minion: {
        list: () => Promise.resolve(initialMinions),
      },
      localStorage: {
        // Seed with different values; backend should win.
        [getModelKey("ws-ai")]: JSON.stringify("anthropic:claude-3.5"),
        [getThinkingLevelKey("ws-ai")]: JSON.stringify("low"),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));

    expect(JSON.parse(globalThis.localStorage.getItem(getModelKey("ws-ai"))!)).toBe(
      "openai:gpt-5.2"
    );
    expect(JSON.parse(globalThis.localStorage.getItem(getThinkingLevelKey("ws-ai"))!)).toBe(
      "xhigh"
    );
  });
  test("loads minion metadata on mount", async () => {
    const initialMinions: FrontendMinionMetadata[] = [
      createMinionMetadata({
        id: "ws-1",
        projectPath: "/alpha",
        projectName: "alpha",
        name: "main",
        namedMinionPath: "/alpha-main",
      }),
    ];

    createMockAPI({
      minion: {
        list: () => Promise.resolve(initialMinions),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));

    const metadata = ctx().minionMetadata.get("ws-1");
    expect(metadata?.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  test("sets empty map on API error during load", async () => {
    createMockAPI({
      minion: {
        list: () => Promise.reject(new Error("API Error")),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().loading).toBe(false));
    expect(ctx().minionMetadata.size).toBe(0);
  });

  test("refreshMinionMetadata reloads minion data", async () => {
    const initialMinions: FrontendMinionMetadata[] = [
      createMinionMetadata({ id: "ws-1" }),
    ];
    const updatedMinions: FrontendMinionMetadata[] = [
      createMinionMetadata({ id: "ws-1" }),
      createMinionMetadata({ id: "ws-2" }),
    ];

    let callCount = 0;
    createMockAPI({
      minion: {
        list: () => {
          callCount++;
          return Promise.resolve(callCount === 1 ? initialMinions : updatedMinions);
        },
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));

    await ctx().refreshMinionMetadata();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(2));
  });

  test("createMinion creates new minion and reloads data", async () => {
    const { minion: minionApi } = createMockAPI();

    const ctx = await setup();

    const newMetadata = createMinionMetadata({ id: "ws-new" });
    minionApi.create.mockResolvedValue({ success: true as const, metadata: newMetadata });

    await ctx().createMinion("path", "name", "main");

    expect(minionApi.create).toHaveBeenCalled();
    // Verify list called (might be 1 or 2 times depending on optimization)
    expect(minionApi.list).toHaveBeenCalled();
  });

  test("createMinion throws on failure", async () => {
    const { minion: minionApi } = createMockAPI();

    const ctx = await setup();

    minionApi.create.mockResolvedValue({ success: false, error: "Failed" });

    return expect(ctx().createMinion("path", "name", "main")).rejects.toThrow("Failed");
  });

  test("removeMinion removes minion and clears selection if active", async () => {
    const initialMinions = [
      createMinionMetadata({
        id: "ws-remove",
        projectPath: "/remove",
        projectName: "remove",
        name: "main",
        namedMinionPath: "/remove-main",
      }),
    ];

    createMockAPI({
      minion: {
        list: () => Promise.resolve(initialMinions),
      },
      localStorage: {
        selectedMinion: JSON.stringify({
          minionId: "ws-remove",
          projectPath: "/remove",
          projectName: "remove",
          namedMinionPath: "/remove-main",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));
    expect(ctx().selectedMinion?.minionId).toBe("ws-remove");

    await ctx().removeMinion("ws-remove");

    await waitFor(() => expect(ctx().selectedMinion).toBeNull());
  });

  test("removeMinion handles failure gracefully", async () => {
    const { minion: minionApi } = createMockAPI();

    const ctx = await setup();

    minionApi.remove.mockResolvedValue({
      success: false,
      error: "Failed",
    });

    const result = await ctx().removeMinion("ws-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed");
  });

  describe("archiveMinion", () => {
    test("succeeds even when persisted layout is invalid JSON shape", async () => {
      const minionId = "ws-archive-invalid-layout";
      const layoutKey = getWorkbenchPanelLayoutKey(minionId);

      const { minion: minionApi } = createMockAPI({
        localStorage: {
          [layoutKey]: JSON.stringify({ broken: true }),
        },
      });

      const ctx = await setup();

      let result: Awaited<ReturnType<MinionContext["archiveMinion"]>> | undefined;
      await act(async () => {
        result = await ctx().archiveMinion(minionId);
      });

      expect(minionApi.archive).toHaveBeenCalledWith({ minionId });
      expect(result).toEqual({ success: true });
    });

    test("strips terminal tabs from valid persisted layout on successful archive", async () => {
      const minionId = "ws-archive-clean-layout";
      const layoutKey = getWorkbenchPanelLayoutKey(minionId);
      const terminalTitlesKey = getTerminalTitlesKey(minionId);
      const persistedLayout: WorkbenchPanelLayoutState = {
        version: 1,
        nextId: 2,
        focusedTabsetId: "tabset-1",
        root: {
          type: "tabset",
          id: "tabset-1",
          tabs: ["costs", "terminal:t1"],
          activeTab: "terminal:t1",
        },
      };

      const { minion: minionApi } = createMockAPI({
        localStorage: {
          [layoutKey]: JSON.stringify(persistedLayout),
          [terminalTitlesKey]: JSON.stringify({ t1: "stale-title" }),
        },
      });

      const ctx = await setup();

      await act(async () => {
        await ctx().archiveMinion(minionId);
      });

      expect(minionApi.archive).toHaveBeenCalledWith({ minionId });

      const cleanedLayout = readPersistedState<WorkbenchPanelLayoutState | null>(layoutKey, null);
      expect(cleanedLayout).not.toBeNull();
      if (cleanedLayout?.root.type !== "tabset") {
        throw new Error("Expected cleaned workbench panel layout to be a tabset");
      }

      expect(cleanedLayout.root.tabs).toEqual(["costs"]);
      expect(cleanedLayout.root.activeTab).toBe("costs");
      expect(
        readPersistedState<Record<string, string>>(terminalTitlesKey, { stale: "title" })
      ).toEqual({});
    });
  });

  test("updateMinionTitle updates minion title via updateTitle API", async () => {
    const initialMinions = [
      createMinionMetadata({
        id: "ws-title-edit",
        projectPath: "/project",
        projectName: "project",
        name: "branch-a1b2",
        namedMinionPath: "/project-branch",
      }),
    ];

    const { minion: minionApi } = createMockAPI({
      minion: {
        list: () => Promise.resolve(initialMinions),
      },
    });

    const ctx = await setup();

    minionApi.updateTitle.mockResolvedValue({
      success: true as const,
      data: undefined,
    });

    // Mock list to return minion with updated title after update
    minionApi.list.mockResolvedValue([
      createMinionMetadata({
        id: "ws-title-edit",
        projectPath: "/project",
        projectName: "project",
        name: "branch-a1b2",
        title: "New Title",
        namedMinionPath: "/project-branch",
      }),
    ]);

    await ctx().updateMinionTitle("ws-title-edit", "New Title");

    expect(minionApi.updateTitle).toHaveBeenCalledWith({
      minionId: "ws-title-edit",
      title: "New Title",
    });
  });

  test("updateMinionTitle handles failure gracefully", async () => {
    const { minion: minionApi } = createMockAPI();

    const ctx = await setup();

    minionApi.updateTitle.mockResolvedValue({
      success: false,
      error: "Failed",
    });

    const result = await ctx().updateMinionTitle("ws-1", "new");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed");
  });

  test("getMinionInfo fetches minion metadata", async () => {
    const { minion: minionApi } = createMockAPI();
    const mockInfo = createMinionMetadata({ id: "ws-info" });
    minionApi.getInfo.mockResolvedValue(mockInfo);

    const ctx = await setup();

    const info = await ctx().getMinionInfo("ws-info");
    expect(info).toEqual(mockInfo);
    expect(minionApi.getInfo).toHaveBeenCalledWith({ minionId: "ws-info" });
  });

  test("beginMinionCreation clears selection and tracks pending state", async () => {
    createMockAPI({
      minion: {
        list: () =>
          Promise.resolve([
            createMinionMetadata({
              id: "ws-existing",
              projectPath: "/existing",
              projectName: "existing",
              name: "main",
              namedMinionPath: "/existing-main",
            }),
          ]),
      },
      localStorage: {
        selectedMinion: JSON.stringify({
          minionId: "ws-existing",
          projectPath: "/existing",
          projectName: "existing",
          namedMinionPath: "/existing-main",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().selectedMinion).toBeTruthy());

    act(() => {
      ctx().beginMinionCreation("/new/project");
    });

    expect(ctx().selectedMinion).toBeNull();
    expect(ctx().pendingNewMinionProject).toBe("/new/project");
  });

  test("reacts to metadata update events (new minion)", async () => {
    const { minion: minionApi } = createMockAPI();
    await setup();

    // Verify subscription started
    await waitFor(() => expect(minionApi.onMetadata).toHaveBeenCalled());

    // Note: We cannot easily simulate incoming events from the async generator mock
    // in this simple setup. We verify the subscription happens.
  });

  test("selectedMinion persists to localStorage", async () => {
    createMockAPI();
    const ctx = await setup();

    const selection = {
      minionId: "ws-persist",
      projectPath: "/persist",
      projectName: "persist",
      namedMinionPath: "/persist-main",
    };

    act(() => {
      ctx().setSelectedMinion(selection);
    });

    await waitFor(() =>
      expect(localStorage.getItem(SELECTED_MINION_KEY)).toContain("ws-persist")
    );
  });

  test("selectedMinion restores from localStorage on mount", async () => {
    createMockAPI({
      minion: {
        list: () =>
          Promise.resolve([
            createMinionMetadata({
              id: "ws-restore",
              projectPath: "/restore",
              projectName: "restore",
              name: "main",
              namedMinionPath: "/restore-main",
            }),
          ]),
      },
      localStorage: {
        selectedMinion: JSON.stringify({
          minionId: "ws-restore",
          projectPath: "/restore",
          projectName: "restore",
          namedMinionPath: "/restore-main",
        }),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().selectedMinion?.minionId).toBe("ws-restore"));
  });

  test("launch project auto-selects minion when no URL hash", async () => {
    // With the new router, URL takes precedence. When there's no URL hash,
    // and localStorage has no saved minion, the launch project kicks in.
    createMockAPI({
      minion: {
        list: () =>
          Promise.resolve([
            createMinionMetadata({
              id: "ws-launch",
              projectPath: "/launch-project",
              projectName: "launch-project",
              name: "main",
              namedMinionPath: "/launch-project-main",
            }),
          ]),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
      server: {
        getLaunchProject: () => Promise.resolve("/launch-project"),
      },
      // No locationHash, no localStorage - so launch project should kick in
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().loading).toBe(false));

    // Should have auto-selected the first minion from launch project
    await waitFor(() => {
      expect(ctx().selectedMinion?.projectPath).toBe("/launch-project");
    });
  });

  test("launch project does not override existing selection", async () => {
    createMockAPI({
      minion: {
        list: () =>
          Promise.resolve([
            createMinionMetadata({
              id: "ws-existing",
              projectPath: "/existing",
              projectName: "existing",
              name: "main",
              namedMinionPath: "/existing-main",
            }),
            createMinionMetadata({
              id: "ws-launch",
              projectPath: "/launch-project",
              projectName: "launch-project",
              name: "main",
              namedMinionPath: "/launch-project-main",
            }),
          ]),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
      localStorage: {
        selectedMinion: JSON.stringify({
          minionId: "ws-existing",
          projectPath: "/existing",
          projectName: "existing",
          namedMinionPath: "/existing-main",
        }),
      },
      server: {
        getLaunchProject: () => Promise.resolve("/launch-project"),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().loading).toBe(false));

    // Should keep existing selection, not switch to launch project
    await waitFor(() => {
      expect(ctx().selectedMinion?.minionId).toBe("ws-existing");
    });
    expect(ctx().selectedMinion?.projectPath).toBe("/existing");
  });

  test("launch project does not override pending minion creation", async () => {
    // Race condition test: if user starts creating a minion while
    // getLaunchProject is in flight, the launch project should not override

    let resolveLaunchProject: (value: string | null) => void;
    const launchProjectPromise = new Promise<string | null>((resolve) => {
      resolveLaunchProject = resolve;
    });

    const initialMinions = [
      createMinionMetadata({
        id: "ws-launch",
        projectPath: "/launch-project",
        projectName: "launch-project",
        name: "main",
        namedMinionPath: "/launch-project-main",
      }),
    ];

    createMockAPI({
      minion: {
        list: () => Promise.resolve(initialMinions),
      },
      server: {
        getLaunchProject: () => launchProjectPromise,
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().loading).toBe(false));

    // User starts minion creation (this sets pendingNewMinionProject)
    act(() => {
      ctx().beginMinionCreation("/new-project");
    });

    // Verify pending state is set
    expect(ctx().pendingNewMinionProject).toBe("/new-project");
    expect(ctx().selectedMinion).toBeNull();

    // Now the launch project response arrives
    await act(async () => {
      resolveLaunchProject!("/launch-project");
      // Give effect time to process
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should NOT have selected the launch project minion because creation is pending
    expect(ctx().selectedMinion).toBeNull();
    expect(ctx().pendingNewMinionProject).toBe("/new-project");
  });

  test("MinionProvider calls ProjectContext.refreshProjects after loading", async () => {
    // Verify that projects.list is called during minion metadata loading
    const projectsListMock = mock(() => Promise.resolve([]));

    createMockAPI({
      minion: {
        list: () => Promise.resolve([]),
      },
      projects: {
        list: projectsListMock,
      },
    });

    await setup();

    await waitFor(() => {
      // projects.list should be called during minion metadata loading
      expect(projectsListMock).toHaveBeenCalled();
    });
  });

  test("ensureCreatedAt adds default timestamp when missing", async () => {
    // Intentionally create incomplete metadata to test default createdAt addition
    const minionWithoutTimestamp = {
      id: "ws-1",
      projectPath: "/alpha",
      projectName: "alpha",
      name: "main",
      namedMinionPath: "/alpha-main",
      // createdAt intentionally omitted to test default value
    } as unknown as FrontendMinionMetadata;

    createMockAPI({
      minion: {
        list: () => Promise.resolve([minionWithoutTimestamp]),
      },
      projects: {
        list: () => Promise.resolve([]),
      },
    });

    const ctx = await setup();

    await waitFor(() => expect(ctx().minionMetadata.size).toBe(1));

    const metadata = ctx().minionMetadata.get("ws-1");
    expect(metadata?.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

async function setup() {
  const contextRef = { current: null as MinionContext | null };
  function ContextCapture() {
    contextRef.current = useMinionContext();
    return null;
  }

  // MinionProvider needs RouterProvider and ProjectProvider
  render(
    <RouterProvider>
      <ProjectProvider>
        <MinionProvider>
          <ContextCapture />
        </MinionProvider>
      </ProjectProvider>
    </RouterProvider>
  );

  // Inject client immediately to handle race conditions where effects run before store update
  getMinionStoreRaw().setClient(currentClientMock as APIClient);

  await waitFor(() => expect(contextRef.current).toBeTruthy());
  return () => contextRef.current!;
}

interface MockAPIOptions {
  minion?: RecursivePartial<APIClient["minion"]>;
  projects?: RecursivePartial<APIClient["projects"]>;
  server?: RecursivePartial<APIClient["server"]>;
  localStorage?: Record<string, string>;
  locationHash?: string;
}

function createMockAPI(options: MockAPIOptions = {}) {
  const happyWindow = new GlobalWindow();
  globalThis.window = happyWindow as unknown as Window & typeof globalThis;
  globalThis.document = happyWindow.document as unknown as Document;
  globalThis.localStorage = happyWindow.localStorage;

  // Set up localStorage with any provided data
  if (options.localStorage) {
    for (const [key, value] of Object.entries(options.localStorage)) {
      globalThis.localStorage.setItem(key, value);
    }
  }

  // Set up location hash if provided
  if (options.locationHash) {
    happyWindow.location.hash = options.locationHash;
  }

  // Create mocks
  const minion = {
    create: mock(
      options.minion?.create ??
        (() =>
          Promise.resolve({
            success: true as const,
            metadata: createMinionMetadata({ id: "ws-1" }),
          }))
    ),
    list: mock(options.minion?.list ?? (() => Promise.resolve([]))),
    remove: mock(options.minion?.remove ?? (() => Promise.resolve({ success: true as const }))),
    archive: mock(
      options.minion?.archive ??
        (() => Promise.resolve({ success: true as const, data: undefined }))
    ),
    unarchive: mock(
      options.minion?.unarchive ??
        (() => Promise.resolve({ success: true as const, data: undefined }))
    ),
    rename: mock(
      options.minion?.rename ??
        (() => Promise.resolve({ success: true as const, data: { newMinionId: "ws-1" } }))
    ),
    updateTitle: mock(
      options.minion?.updateTitle ??
        (() => Promise.resolve({ success: true as const, data: undefined }))
    ),
    getInfo: mock(options.minion?.getInfo ?? (() => Promise.resolve(null))),
    // Async generators for subscriptions
    onMetadata: mock(
      options.minion?.onMetadata ??
        (async () => {
          await Promise.resolve();
          return (
            // eslint-disable-next-line require-yield
            (async function* () {
              await Promise.resolve();
            })() as unknown as Awaited<ReturnType<APIClient["minion"]["onMetadata"]>>
          );
        })
    ),
    getSessionUsage: mock(options.minion?.getSessionUsage ?? (() => Promise.resolve(undefined))),
    onChat: mock(
      options.minion?.onChat ??
        (async () => {
          await Promise.resolve();
          return (
            // eslint-disable-next-line require-yield
            (async function* () {
              await Promise.resolve();
            })() as unknown as Awaited<ReturnType<APIClient["minion"]["onChat"]>>
          );
        })
    ),
    activity: {
      list: mock(options.minion?.activity?.list ?? (() => Promise.resolve({}))),
      subscribe: mock(
        options.minion?.activity?.subscribe ??
          (async () => {
            await Promise.resolve();
            return (
              // eslint-disable-next-line require-yield
              (async function* () {
                await Promise.resolve();
              })() as unknown as Awaited<
                ReturnType<APIClient["minion"]["activity"]["subscribe"]>
              >
            );
          })
      ),
    },
    // Needed for ProjectCreateModal
    truncateHistory: mock(() => Promise.resolve({ success: true as const, data: undefined })),
    interruptStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
  };

  const projects = {
    list: mock(options.projects?.list ?? (() => Promise.resolve([]))),
    listBranches: mock(() => Promise.resolve({ branches: ["main"], recommendedTrunk: "main" })),
    secrets: {
      get: mock(() => Promise.resolve([])),
    },
  };

  const server = {
    getLaunchProject: mock(options.server?.getLaunchProject ?? (() => Promise.resolve(null))),
  };

  const terminal = {
    openWindow: mock(() => Promise.resolve()),
  };

  // Update the global mock
  currentClientMock = {
    minion,
    projects,
    server,
    terminal,
  };

  return { minion, projects, window: happyWindow };
}
