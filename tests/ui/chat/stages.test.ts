/**
 * Integration tests for minion stages.
 *
 * Tests verify:
 * - Stage UI elements render correctly with proper data attributes
 * - Stage and drop zone UI elements render with proper data attributes
 * - Workspace creation with stageId assigns to that stage
 * - Stage "+" button pre-selects stage in creation flow
 * - Stage removal invariants (removal unstages active/archived workspaces)
 * - Stage reordering via API and UI reflection
 *
 * Testing approach:
 * - Stage creation uses ORPC (happy-dom doesn't reliably handle React controlled inputs)
 * - We test that stages render correctly, not the text input submission interaction
 * - Workspace creation uses ORPC for speed (setup/teardown is acceptable per AGENTS.md)
 * - DnD gestures tested in Storybook (react-dnd-html5-backend doesn't work in happy-dom)
 */

import "../dom";
import { act, fireEvent, waitFor } from "@testing-library/react";

import { shouldRunIntegrationTests } from "../../testUtils";
import {
  cleanupSharedRepo,
  createSharedRepo,
  getSharedEnv,
  getSharedRepoPath,
} from "../../ipc/sendMessageTestHelpers";
import { generateBranchName } from "../../ipc/helpers";
import { detectDefaultTrunkBranch } from "../../../src/node/git";

import { installDom } from "../dom";
import { renderApp } from "../renderReviewPanel";
import { cleanupView, setupWorkspaceView } from "../helpers";
import { expandProjects } from "@/browser/stories/storyHelpers";

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find a workspace row in the sidebar by workspace ID.
 */
function findWorkspaceRow(container: HTMLElement, workspaceId: string): HTMLElement | null {
  return container.querySelector(`[data-workspace-id="${workspaceId}"]`);
}

/**
 * Find a stage drop zone in the sidebar by stage ID.
 */
function findStageDropZone(container: HTMLElement, stageId: string): HTMLElement | null {
  return container.querySelector(`[data-drop-stage-id="${stageId}"]`);
}

/**
 * Find the unstaged workspaces drop zone.
 */
function findUnstagedDropZone(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="unstaged-drop-zone"]');
}

/**
 * Wait for a stage header to appear in the sidebar.
 */
async function waitForStage(
  container: HTMLElement,
  stageId: string,
  timeoutMs = 5_000
): Promise<HTMLElement> {
  return waitFor(
    () => {
      const stage = container.querySelector(`[data-stage-id="${stageId}"]`);
      if (!stage) throw new Error(`Stage ${stageId} not found`);
      return stage as HTMLElement;
    },
    { timeout: timeoutMs }
  );
}

/**
 * Get all stage IDs in DOM order.
 */
function getStageIdsInOrder(container: HTMLElement): string[] {
  const stages = container.querySelectorAll("[data-stage-id]");
  return Array.from(stages)
    .map((el) => el.getAttribute("data-stage-id"))
    .filter((id): id is string => id !== null && id !== "");
}

/**
 * Create a stage via ORPC. Returns the stage ID.
 *
 * Note: This does NOT wait for UI to update - use with tests that don't need
 * immediate UI reflection, or call refreshProjects() after and wait appropriately.
 *
 * We use ORPC instead of UI interactions because happy-dom doesn't properly
 * handle React controlled inputs (fireEvent.change doesn't trigger React state updates
 * synchronously, causing keyDown/blur handlers to see stale state).
 */
async function createStageViaAPI(
  env: ReturnType<typeof getSharedEnv>,
  projectPath: string,
  stageName: string
): Promise<string> {
  const result = await env.orpc.projects.stages.create({
    projectPath,
    name: stageName,
  });

  if (!result.success) {
    throw new Error(`Failed to create stage: ${result.error}`);
  }

  return result.data.id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describeIntegration("Workspace Stages", () => {
  beforeAll(async () => {
    await createSharedRepo();
  });

  afterAll(async () => {
    await cleanupSharedRepo();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // UI Infrastructure
  // ─────────────────────────────────────────────────────────────────────────────

  test("stage renders with drop zones after creation", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();

    // Create a workspace first (ORPC is fine for setup)
    const branchName = generateBranchName("test-stage-ui");
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName,
      trunkBranch,
    });
    if (!wsResult.success) throw new Error(`Failed to create workspace: ${wsResult.error}`);
    const workspaceId = wsResult.metadata.id;
    const metadata = wsResult.metadata;

    // Create stage BEFORE rendering so it's in the initial config
    const stageId = await createStageViaAPI(env, projectPath, "Test Stage");

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata });

    try {
      await setupWorkspaceView(view, metadata, workspaceId);

      // Wait for stage to appear in UI
      await waitForStage(view.container, stageId);

      // Verify stage drop zone exists (for workspace drag-drop)
      const stageDropZone = findStageDropZone(view.container, stageId);
      expect(stageDropZone).not.toBeNull();

      // Verify unstaged drop zone exists when stages are present
      const unstagedZone = findUnstagedDropZone(view.container);
      expect(unstagedZone).not.toBeNull();

      // Verify workspace row exists and has data-stage-id attribute
      const workspaceRow = findWorkspaceRow(view.container, workspaceId);
      expect(workspaceRow).not.toBeNull();
      expect(workspaceRow!.hasAttribute("data-stage-id")).toBe(true);

      // Verify stage has drag-related attribute for reordering
      const stageDragWrapper = view.container.querySelector(
        `[data-stage-drag-id="${stageId}"]`
      );
      expect(stageDragWrapper).not.toBeNull();
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId });
    }
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Workspace Creation with Stage
  // ─────────────────────────────────────────────────────────────────────────────

  test("workspace created with stageId is assigned to that stage", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create workspace without stage first to ensure project exists
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    const stageResult = await env.orpc.projects.stages.create({
      projectPath,
      name: "Target Stage",
    });
    if (!stageResult.success) throw new Error(`Failed to create stage: ${stageResult.error}`);
    const stageId = stageResult.data.id;

    let workspaceId: string | undefined;
    try {
      // Create workspace WITH stageId
      const wsResult = await env.orpc.minion.create({
        projectPath,
        branchName: generateBranchName("test-create-in-stage"),
        trunkBranch,
        stageId: stageId,
      });
      if (!wsResult.success) throw new Error(`Failed to create workspace: ${wsResult.error}`);
      workspaceId = wsResult.metadata.id;

      // Verify workspace metadata has the stageId
      const workspaceInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(workspaceInfo?.stageId).toBe(stageId);
    } finally {
      if (workspaceId) await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId });
    }
  }, 60_000);

  test("clicking stage add button sets pending stage for creation", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create workspace to ensure project exists (ORPC for setup is acceptable)
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-stage-add"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create stage BEFORE rendering so it's in the initial config
    const stageId = await createStageViaAPI(env, projectPath, "Add Button Stage");

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata: setupWs.metadata });

    try {
      await setupWorkspaceView(view, setupWs.metadata, setupWs.metadata.id);

      // Wait for stage to render
      await waitForStage(view.container, stageId);

      // Find the "+" button in the stage header
      const stageHeader = view.container.querySelector(`[data-stage-id="${stageId}"]`);
      expect(stageHeader).not.toBeNull();

      const addButton = stageHeader!.querySelector(
        'button[aria-label="New workspace in stage"]'
      );
      expect(addButton).not.toBeNull();

      // Click the add button - this should navigate to create page with stage context
      // Wrap in act() to ensure React state updates are properly flushed
      await act(async () => {
        fireEvent.click(addButton as HTMLElement);
      });

      // Wait for the create page to show stage selector with this stage pre-selected
      await waitFor(
        () => {
          const stageSelector = view.container.querySelector('[data-testid="stage-selector"]');
          if (!stageSelector) {
            throw new Error("Stage selector not found on create page");
          }
          const selectedValue = stageSelector.getAttribute("data-selected-stage");
          if (selectedValue !== stageId) {
            throw new Error(`Expected stage ${stageId} to be selected, got ${selectedValue}`);
          }
        },
        { timeout: 5_000 }
      );

      // The creation UI should allow clearing the selection (return to unstaged).
      const stageSelector = view.container.querySelector('[data-testid="stage-selector"]');
      if (!stageSelector) {
        throw new Error("Stage selector not found on create page (post-selection)");
      }

      const clearButton = stageSelector.querySelector(
        'button[aria-label="Clear stage selection"]'
      );
      expect(clearButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(clearButton as HTMLElement);
      });

      await waitFor(() => {
        expect(stageSelector.getAttribute("data-selected-stage")).toBe("");
      });
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId });
    }
  }, 60_000);

  test("fork API preserves stage assignment", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a workspace first to ensure the project is registered.
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-fork-stage"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create a stage and a workspace inside it.
    const stageId = await createStageViaAPI(env, projectPath, "Fork Stage");

    let sourceMinionId: string | undefined;
    let forkedWorkspaceId: string | undefined;

    try {
      const sourceWsResult = await env.orpc.minion.create({
        projectPath,
        branchName: generateBranchName("fork-stage-source"),
        trunkBranch,
        stageId: stageId,
      });
      if (!sourceWsResult.success) {
        throw new Error(`Failed to create source workspace: ${sourceWsResult.error}`);
      }

      sourceMinionId = sourceWsResult.metadata.id;

      const forkedName = generateBranchName("forked-in-stage");
      const forkResult = await env.orpc.minion.fork({
        sourceMinionId,
        newName: forkedName,
      });
      if (!forkResult.success) {
        throw new Error(`Failed to fork workspace: ${forkResult.error}`);
      }

      forkedWorkspaceId = forkResult.metadata.id;
      expect(forkResult.metadata.stageId).toBe(stageId);
    } finally {
      // Best-effort cleanup: remove any workspaces still assigned to this stage,
      // even if the assertion failed before we captured forkedWorkspaceId.
      const activeWorkspaces = await env.orpc.minion.list();
      const stageWorkspaceIds = activeWorkspaces
        .filter((workspace) => workspace.stageId === stageId)
        .map((workspace) => workspace.id);

      if (forkedWorkspaceId) {
        stageWorkspaceIds.push(forkedWorkspaceId);
      }
      if (sourceMinionId) {
        stageWorkspaceIds.push(sourceMinionId);
      }

      const uniqueWorkspaceIds = [...new Set(stageWorkspaceIds)].filter(
        (workspaceId) => workspaceId !== setupWs.metadata.id
      );

      for (const workspaceId of uniqueWorkspaceIds) {
        await env.orpc.minion.remove({ minionId: workspaceId }).catch(() => {});
      }

      await env.orpc.minion.remove({ minionId: setupWs.metadata.id }).catch(() => {});
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId }).catch(() => {});
    }
  }, 60_000);
  // ─────────────────────────────────────────────────────────────────────────────
  // Stage Reordering
  // ─────────────────────────────────────────────────────────────────────────────

  test("reorderStages API updates stage order", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a workspace to ensure project exists
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-reorder-api"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create three stages (they'll be in creation order: A, B, C)
    const stageA = await env.orpc.projects.stages.create({
      projectPath,
      name: "Stage A",
    });
    if (!stageA.success) throw new Error(`Failed to create stage: ${stageA.error}`);

    const stageB = await env.orpc.projects.stages.create({
      projectPath,
      name: "Stage B",
    });
    if (!stageB.success) throw new Error(`Failed to create stage: ${stageB.error}`);

    const stageC = await env.orpc.projects.stages.create({
      projectPath,
      name: "Stage C",
    });
    if (!stageC.success) throw new Error(`Failed to create stage: ${stageC.error}`);

    try {
      // Verify initial order for the stages created in this test.
      let stages = await env.orpc.projects.stages.list({ projectPath });
      const trackedStageIds = [stageA.data.id, stageB.data.id, stageC.data.id];
      const trackedInitialOrder = stages
        .filter((stage) => trackedStageIds.includes(stage.id))
        .map((stage) => stage.name);
      expect(trackedInitialOrder).toEqual(["Stage A", "Stage B", "Stage C"]);

      // Reorder to C, A, B
      const reorderResult = await env.orpc.projects.stages.reorder({
        projectPath,
        stageIds: [stageC.data.id, stageA.data.id, stageB.data.id],
      });
      expect(reorderResult.success).toBe(true);

      // Verify new order for the stages created in this test.
      stages = await env.orpc.projects.stages.list({ projectPath });
      const trackedReordered = stages
        .filter((stage) => trackedStageIds.includes(stage.id))
        .map((stage) => stage.name);
      expect(trackedReordered).toEqual(["Stage C", "Stage A", "Stage B"]);
    } finally {
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageA.data.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageB.data.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageC.data.id });
    }
  }, 60_000);

  // Note: UI auto-refresh after reorder requires the full DnD flow which triggers
  // ProjectContext.reorderStages -> refreshProjects(). Direct API calls bypass this.
  // The sorting logic is unit-tested in workspaceFiltering.test.ts (sortStagesByLinkedList).
  // This test verifies initial render respects stage order from backend.
  test("stages render in linked-list order from config", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a workspace to ensure project exists
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-stage-order"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create two stages (will be in creation order: First, Second)
    const stageFirst = await env.orpc.projects.stages.create({
      projectPath,
      name: "First Stage",
    });
    if (!stageFirst.success) throw new Error(`Failed to create stage: ${stageFirst.error}`);

    const stageSecond = await env.orpc.projects.stages.create({
      projectPath,
      name: "Second Stage",
    });
    if (!stageSecond.success) throw new Error(`Failed to create stage: ${stageSecond.error}`);

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata: setupWs.metadata });

    try {
      await setupWorkspaceView(view, setupWs.metadata, setupWs.metadata.id);

      // Wait for stages to appear
      await waitForStage(view.container, stageFirst.data.id);
      await waitForStage(view.container, stageSecond.data.id);

      // Verify DOM order matches linked-list order (First -> Second) for the
      // stages created in this test. Other stages may exist from unrelated setup.
      const orderedIds = getStageIdsInOrder(view.container);
      const trackedOrder = orderedIds.filter(
        (id) => id === stageFirst.data.id || id === stageSecond.data.id
      );
      expect(trackedOrder).toEqual([stageFirst.data.id, stageSecond.data.id]);
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageFirst.data.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageSecond.data.id });
    }
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Stage Removal Invariants
  // ─────────────────────────────────────────────────────────────────────────────

  test("removing stage clears stageId from active workspaces", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a setup workspace first to ensure project is registered
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-removal"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create a stage
    const stageResult = await env.orpc.projects.stages.create({
      projectPath,
      name: `test-stage-${Date.now()}`,
    });
    expect(stageResult.success).toBe(true);
    const stageId = stageResult.success ? stageResult.data.id : "";

    // Create a workspace in that stage
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("stage-removal-test"),
      trunkBranch,
      stageId: stageId,
    });
    expect(wsResult.success).toBe(true);
    const workspaceId = wsResult.success ? wsResult.metadata.id : "";

    try {
      // Verify workspace starts staged
      let wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.stageId).toBe(stageId);

      // Remove stage with active workspaces - should succeed and unstage the workspace
      const removeResult = await env.orpc.projects.stages.remove({
        projectPath,
        stageId: stageId,
      });
      expect(removeResult.success).toBe(true);

      // Verify stage was removed
      const stages = await env.orpc.projects.stages.list({ projectPath });
      expect(stages.some((stage) => stage.id === stageId)).toBe(false);

      // Verify workspace's stageId is now cleared
      wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.stageId).toBeUndefined();
    } finally {
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId }).catch(() => {});
    }
  }, 30_000);

  test("removing stage clears stageId from archived workspaces", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a setup workspace first to ensure project is registered
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-archive"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create a stage
    const stageResult = await env.orpc.projects.stages.create({
      projectPath,
      name: `test-stage-archive-${Date.now()}`,
    });
    expect(stageResult.success).toBe(true);
    const stageId = stageResult.success ? stageResult.data.id : "";

    // Create a workspace in that stage
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("archive-stage-test"),
      trunkBranch,
      stageId: stageId,
    });
    expect(wsResult.success).toBe(true);
    const workspaceId = wsResult.success ? wsResult.metadata.id : "";

    try {
      // Archive the workspace
      const archiveResult = await env.orpc.minion.archive({ minionId: workspaceId });
      expect(archiveResult.success).toBe(true);

      // Verify workspace is archived and has stageId
      let wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.stageId).toBe(stageId);
      expect(wsInfo?.archivedAt).toBeDefined();

      // Now remove the stage - should succeed since workspace is archived
      const removeResult = await env.orpc.projects.stages.remove({
        projectPath,
        stageId: stageId,
      });
      expect(removeResult.success).toBe(true);

      // Verify workspace's stageId is now cleared
      wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.stageId).toBeUndefined();
    } finally {
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      // Stage already removed in test, but try anyway in case test failed early
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId }).catch(() => {});
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Stage Deletion Confirmation Flow
  // ─────────────────────────────────────────────────────────────────────────────

  test("clicking delete on stage with active workspaces confirms and unstages workspaces", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a setup workspace first to ensure project is registered
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-delete-confirm"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create a stage
    const stageResult = await env.orpc.projects.stages.create({
      projectPath,
      name: `test-delete-confirm-${Date.now()}`,
    });
    expect(stageResult.success).toBe(true);
    const stageId = stageResult.success ? stageResult.data.id : "";

    // Create a workspace in that stage (active, not archived)
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("in-stage-delete-confirm"),
      trunkBranch,
      stageId: stageId,
    });
    expect(wsResult.success).toBe(true);
    const workspaceId = wsResult.success ? wsResult.metadata.id : "";
    const metadata = wsResult.success ? wsResult.metadata : setupWs.metadata;

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata });

    try {
      await setupWorkspaceView(view, metadata, workspaceId);

      // Wait for stage and workspace to appear in UI as staged
      await waitForStage(view.container, stageId);
      const workspaceRowBeforeDelete = findWorkspaceRow(view.container, workspaceId);
      expect(workspaceRowBeforeDelete).not.toBeNull();
      expect(workspaceRowBeforeDelete?.getAttribute("data-stage-id")).toBe(stageId);

      // Find and click the delete button on the stage
      const stageElement = view.container.querySelector(`[data-stage-id="${stageId}"]`);
      expect(stageElement).not.toBeNull();

      // Hover over stage to reveal action buttons (they're only visible on hover)
      fireEvent.mouseEnter(stageElement!);

      const deleteButton = stageElement!.querySelector('[aria-label="Delete stage"]');
      expect(deleteButton).not.toBeNull();
      fireEvent.click(deleteButton!);

      // Confirm the deletion warning for active workspaces
      const confirmDialog = await waitFor(
        () => {
          const dialog = view.container.ownerDocument.body.querySelector('[role="dialog"]');
          if (!dialog) throw new Error("Delete confirmation dialog not found");

          const dialogText = dialog.textContent ?? "";
          if (!dialogText.includes("Delete stage?")) {
            throw new Error(`Expected delete confirmation title, got: ${dialogText}`);
          }
          if (!dialogText.includes("will be moved to unstaged")) {
            throw new Error(`Expected unstage warning, got: ${dialogText}`);
          }

          return dialog as HTMLElement;
        },
        { timeout: 5_000 }
      );

      const confirmDeleteButton = Array.from(confirmDialog.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Delete")
      );
      if (!confirmDeleteButton) {
        throw new Error("Delete confirmation button not found");
      }
      fireEvent.click(confirmDeleteButton);

      // Section should be removed from UI
      await waitFor(
        () => {
          const removedSection = view.container.querySelector(`[data-stage-id="${stageId}"]`);
          if (removedSection) throw new Error("Section was not removed from the sidebar");
        },
        { timeout: 5_000 }
      );

      // Workspace should remain but become unstaged
      await waitFor(
        () => {
          const workspaceRow = findWorkspaceRow(view.container, workspaceId);
          if (!workspaceRow) throw new Error("Workspace row not found after deleting stage");

          const updatedSectionId = workspaceRow.getAttribute("data-stage-id");
          if (updatedSectionId !== "") {
            throw new Error(
              `Expected workspace to be unstaged, got data-stage-id=${updatedSectionId}`
            );
          }
        },
        { timeout: 5_000 }
      );

      // Backend should reflect the unstaged workspace as well
      const wsInfoAfterDelete = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfoAfterDelete).not.toBeNull();
      expect(wsInfoAfterDelete?.stageId).toBeUndefined();
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.stages.remove({ projectPath, stageId: stageId }).catch(() => {});
    }
  }, 60_000);
});
