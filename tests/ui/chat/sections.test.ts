/**
 * Integration tests for minion crews.
 *
 * Tests verify:
 * - Section UI elements render correctly with proper data attributes
 * - Section and drop zone UI elements render with proper data attributes
 * - Workspace creation with crewId assigns to that crew
 * - Crew "+" button pre-selects crew in creation flow
 * - Section removal invariants (removal unsections active/archived workspaces)
 * - Section reordering via API and UI reflection
 *
 * Testing approach:
 * - Section creation uses ORPC (happy-dom doesn't reliably handle React controlled inputs)
 * - We test that crews render correctly, not the text input submission interaction
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
 * Find a crew drop zone in the sidebar by section ID.
 */
function findCrewDropZone(container: HTMLElement, crewId: string): HTMLElement | null {
  return container.querySelector(`[data-drop-crew-id="${crewId}"]`);
}

/**
 * Find the unsectioned workspaces drop zone.
 */
function findUnsectionedDropZone(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="unsectioned-drop-zone"]');
}

/**
 * Wait for a crew header to appear in the sidebar.
 */
async function waitForCrew(
  container: HTMLElement,
  crewId: string,
  timeoutMs = 5_000
): Promise<HTMLElement> {
  return waitFor(
    () => {
      const section = container.querySelector(`[data-crew-id="${crewId}"]`);
      if (!section) throw new Error(`Crew ${crewId} not found`);
      return section as HTMLElement;
    },
    { timeout: timeoutMs }
  );
}

/**
 * Get all crew IDs in DOM order.
 */
function getSectionIdsInOrder(container: HTMLElement): string[] {
  const sections = container.querySelectorAll("[data-crew-id]");
  return Array.from(sections)
    .map((el) => el.getAttribute("data-crew-id"))
    .filter((id): id is string => id !== null && id !== "");
}

/**
 * Create a section via ORPC. Returns the section ID.
 *
 * Note: This does NOT wait for UI to update - use with tests that don't need
 * immediate UI reflection, or call refreshProjects() after and wait appropriately.
 *
 * We use ORPC instead of UI interactions because happy-dom doesn't properly
 * handle React controlled inputs (fireEvent.change doesn't trigger React state updates
 * synchronously, causing keyDown/blur handlers to see stale state).
 */
async function createCrewViaAPI(
  env: ReturnType<typeof getSharedEnv>,
  projectPath: string,
  crewName: string
): Promise<string> {
  const result = await env.orpc.projects.crews.create({
    projectPath,
    name: crewName,
  });

  if (!result.success) {
    throw new Error(`Failed to create crew: ${result.error}`);
  }

  return result.data.id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describeIntegration("Workspace Sections", () => {
  beforeAll(async () => {
    await createSharedRepo();
  });

  afterAll(async () => {
    await cleanupSharedRepo();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // UI Infrastructure
  // ─────────────────────────────────────────────────────────────────────────────

  test("crew renders with drop zones after creation", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();

    // Create a workspace first (ORPC is fine for setup)
    const branchName = generateBranchName("test-crew-ui");
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName,
      trunkBranch,
    });
    if (!wsResult.success) throw new Error(`Failed to create workspace: ${wsResult.error}`);
    const workspaceId = wsResult.metadata.id;
    const metadata = wsResult.metadata;

    // Create crew BEFORE rendering so it's in the initial config
    const sectionId = await createCrewViaAPI(env, projectPath, "Test Crew");

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata });

    try {
      await setupWorkspaceView(view, metadata, workspaceId);

      // Wait for crew to appear in UI
      await waitForCrew(view.container, sectionId);

      // Verify crew drop zone exists (for workspace drag-drop)
      const crewDropZone = findCrewDropZone(view.container, sectionId);
      expect(crewDropZone).not.toBeNull();

      // Verify unsectioned drop zone exists when sections are present
      const unsectionedZone = findUnsectionedDropZone(view.container);
      expect(unsectionedZone).not.toBeNull();

      // Verify workspace row exists and has data-crew-id attribute
      const workspaceRow = findWorkspaceRow(view.container, workspaceId);
      expect(workspaceRow).not.toBeNull();
      expect(workspaceRow!.hasAttribute("data-crew-id")).toBe(true);

      // Verify section has drag-related attribute for reordering
      const sectionDragWrapper = view.container.querySelector(
        `[data-section-drag-id="${sectionId}"]`
      );
      expect(sectionDragWrapper).not.toBeNull();
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId });
    }
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Workspace Creation with Section
  // ─────────────────────────────────────────────────────────────────────────────

  test("workspace created with crewId is assigned to that section", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create workspace without section first to ensure project exists
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    const sectionResult = await env.orpc.projects.crews.create({
      projectPath,
      name: "Target Section",
    });
    if (!sectionResult.success) throw new Error(`Failed to create crew: ${sectionResult.error}`);
    const sectionId = sectionResult.data.id;

    let workspaceId: string | undefined;
    try {
      // Create workspace WITH sectionId
      const wsResult = await env.orpc.minion.create({
        projectPath,
        branchName: generateBranchName("test-create-in-section"),
        trunkBranch,
        crewId: sectionId,
      });
      if (!wsResult.success) throw new Error(`Failed to create workspace: ${wsResult.error}`);
      workspaceId = wsResult.metadata.id;

      // Verify workspace metadata has the sectionId
      const workspaceInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(workspaceInfo?.crewId).toBe(sectionId);
    } finally {
      if (workspaceId) await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId });
    }
  }, 60_000);

  test("clicking section add button sets pending section for creation", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create workspace to ensure project exists (ORPC for setup is acceptable)
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-section-add"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create crew BEFORE rendering so it's in the initial config
    const sectionId = await createCrewViaAPI(env, projectPath, "Add Button Section");

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata: setupWs.metadata });

    try {
      await setupWorkspaceView(view, setupWs.metadata, setupWs.metadata.id);

      // Wait for section to render
      await waitForCrew(view.container, sectionId);

      // Find the "+" button in the crew header
      const sectionHeader = view.container.querySelector(`[data-crew-id="${sectionId}"]`);
      expect(sectionHeader).not.toBeNull();

      const addButton = sectionHeader!.querySelector(
        'button[aria-label="New workspace in section"]'
      );
      expect(addButton).not.toBeNull();

      // Click the add button - this should navigate to create page with section context
      // Wrap in act() to ensure React state updates are properly flushed
      await act(async () => {
        fireEvent.click(addButton as HTMLElement);
      });

      // Wait for the create page to show section selector with this section pre-selected
      await waitFor(
        () => {
          const sectionSelector = view.container.querySelector('[data-testid="section-selector"]');
          if (!sectionSelector) {
            throw new Error("Section selector not found on create page");
          }
          const selectedValue = sectionSelector.getAttribute("data-selected-section");
          if (selectedValue !== sectionId) {
            throw new Error(`Expected section ${sectionId} to be selected, got ${selectedValue}`);
          }
        },
        { timeout: 5_000 }
      );

      // The creation UI should allow clearing the selection (return to unsectioned).
      const sectionSelector = view.container.querySelector('[data-testid="section-selector"]');
      if (!sectionSelector) {
        throw new Error("Section selector not found on create page (post-selection)");
      }

      const clearButton = sectionSelector.querySelector(
        'button[aria-label="Clear section selection"]'
      );
      expect(clearButton).not.toBeNull();

      await act(async () => {
        fireEvent.click(clearButton as HTMLElement);
      });

      await waitFor(() => {
        expect(sectionSelector.getAttribute("data-selected-section")).toBe("");
      });
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId });
    }
  }, 60_000);

  test("fork API preserves section assignment", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a workspace first to ensure the project is registered.
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-fork-section"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create a section and a workspace inside it.
    const sectionId = await createCrewViaAPI(env, projectPath, "Fork Section");

    let sourceMinionId: string | undefined;
    let forkedWorkspaceId: string | undefined;

    try {
      const sourceWsResult = await env.orpc.minion.create({
        projectPath,
        branchName: generateBranchName("fork-section-source"),
        trunkBranch,
        crewId: sectionId,
      });
      if (!sourceWsResult.success) {
        throw new Error(`Failed to create source workspace: ${sourceWsResult.error}`);
      }

      sourceMinionId = sourceWsResult.metadata.id;

      const forkedName = generateBranchName("forked-in-section");
      const forkResult = await env.orpc.minion.fork({
        sourceMinionId,
        newName: forkedName,
      });
      if (!forkResult.success) {
        throw new Error(`Failed to fork workspace: ${forkResult.error}`);
      }

      forkedWorkspaceId = forkResult.metadata.id;
      expect(forkResult.metadata.crewId).toBe(sectionId);
    } finally {
      // Best-effort cleanup: remove any workspaces still assigned to this section,
      // even if the assertion failed before we captured forkedWorkspaceId.
      const activeWorkspaces = await env.orpc.minion.list();
      const sectionWorkspaceIds = activeWorkspaces
        .filter((workspace) => workspace.crewId === sectionId)
        .map((workspace) => workspace.id);

      if (forkedWorkspaceId) {
        sectionWorkspaceIds.push(forkedWorkspaceId);
      }
      if (sourceMinionId) {
        sectionWorkspaceIds.push(sourceMinionId);
      }

      const uniqueWorkspaceIds = [...new Set(sectionWorkspaceIds)].filter(
        (workspaceId) => workspaceId !== setupWs.metadata.id
      );

      for (const workspaceId of uniqueWorkspaceIds) {
        await env.orpc.minion.remove({ minionId: workspaceId }).catch(() => {});
      }

      await env.orpc.minion.remove({ minionId: setupWs.metadata.id }).catch(() => {});
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId }).catch(() => {});
    }
  }, 60_000);
  // ─────────────────────────────────────────────────────────────────────────────
  // Section Reordering
  // ─────────────────────────────────────────────────────────────────────────────

  test("reorderSections API updates section order", async () => {
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

    // Create three sections (they'll be in creation order: A, B, C)
    const sectionA = await env.orpc.projects.crews.create({
      projectPath,
      name: "Section A",
    });
    if (!sectionA.success) throw new Error(`Failed to create crew: ${sectionA.error}`);

    const sectionB = await env.orpc.projects.crews.create({
      projectPath,
      name: "Section B",
    });
    if (!sectionB.success) throw new Error(`Failed to create crew: ${sectionB.error}`);

    const sectionC = await env.orpc.projects.crews.create({
      projectPath,
      name: "Section C",
    });
    if (!sectionC.success) throw new Error(`Failed to create crew: ${sectionC.error}`);

    try {
      // Verify initial order for the sections created in this test.
      let sections = await env.orpc.projects.crews.list({ projectPath });
      const trackedSectionIds = [sectionA.data.id, sectionB.data.id, sectionC.data.id];
      const trackedInitialOrder = sections
        .filter((section) => trackedSectionIds.includes(section.id))
        .map((section) => section.name);
      expect(trackedInitialOrder).toEqual(["Section A", "Section B", "Section C"]);

      // Reorder to C, A, B
      const reorderResult = await env.orpc.projects.crews.reorder({
        projectPath,
        crewIds: [sectionC.data.id, sectionA.data.id, sectionB.data.id],
      });
      expect(reorderResult.success).toBe(true);

      // Verify new order for the sections created in this test.
      sections = await env.orpc.projects.crews.list({ projectPath });
      const trackedReordered = sections
        .filter((section) => trackedSectionIds.includes(section.id))
        .map((section) => section.name);
      expect(trackedReordered).toEqual(["Section C", "Section A", "Section B"]);
    } finally {
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionA.data.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionB.data.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionC.data.id });
    }
  }, 60_000);

  // Note: UI auto-refresh after reorder requires the full DnD flow which triggers
  // ProjectContext.reorderSections -> refreshProjects(). Direct API calls bypass this.
  // The sorting logic is unit-tested in workspaceFiltering.test.ts (sortSectionsByLinkedList).
  // This test verifies initial render respects section order from backend.
  test("sections render in linked-list order from config", async () => {
    const env = getSharedEnv();
    const projectPath = getSharedRepoPath();
    const trunkBranch = await detectDefaultTrunkBranch(projectPath);

    // Create a workspace to ensure project exists
    const setupWs = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("setup-section-order"),
      trunkBranch,
    });
    if (!setupWs.success) throw new Error(`Setup failed: ${setupWs.error}`);

    // Create two sections (will be in creation order: First, Second)
    const sectionFirst = await env.orpc.projects.crews.create({
      projectPath,
      name: "First Section",
    });
    if (!sectionFirst.success) throw new Error(`Failed to create crew: ${sectionFirst.error}`);

    const sectionSecond = await env.orpc.projects.crews.create({
      projectPath,
      name: "Second Section",
    });
    if (!sectionSecond.success) throw new Error(`Failed to create crew: ${sectionSecond.error}`);

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata: setupWs.metadata });

    try {
      await setupWorkspaceView(view, setupWs.metadata, setupWs.metadata.id);

      // Wait for sections to appear
      await waitForCrew(view.container, sectionFirst.data.id);
      await waitForCrew(view.container, sectionSecond.data.id);

      // Verify DOM order matches linked-list order (First -> Second) for the
      // sections created in this test. Other sections may exist from unrelated setup.
      const orderedIds = getSectionIdsInOrder(view.container);
      const trackedOrder = orderedIds.filter(
        (id) => id === sectionFirst.data.id || id === sectionSecond.data.id
      );
      expect(trackedOrder).toEqual([sectionFirst.data.id, sectionSecond.data.id]);
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionFirst.data.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionSecond.data.id });
    }
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Section Removal Invariants
  // ─────────────────────────────────────────────────────────────────────────────

  test("removing section clears crewId from active workspaces", async () => {
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

    // Create a section
    const sectionResult = await env.orpc.projects.crews.create({
      projectPath,
      name: `test-section-${Date.now()}`,
    });
    expect(sectionResult.success).toBe(true);
    const sectionId = sectionResult.success ? sectionResult.data.id : "";

    // Create a workspace in that section
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("section-removal-test"),
      trunkBranch,
      crewId: sectionId,
    });
    expect(wsResult.success).toBe(true);
    const workspaceId = wsResult.success ? wsResult.metadata.id : "";

    try {
      // Verify workspace starts sectioned
      let wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.crewId).toBe(sectionId);

      // Remove section with active workspaces - should succeed and unsection the workspace
      const removeResult = await env.orpc.projects.crews.remove({
        projectPath,
        crewId: sectionId,
      });
      expect(removeResult.success).toBe(true);

      // Verify section was removed
      const sections = await env.orpc.projects.crews.list({ projectPath });
      expect(sections.some((section) => section.id === sectionId)).toBe(false);

      // Verify workspace's sectionId is now cleared
      wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.crewId).toBeUndefined();
    } finally {
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId }).catch(() => {});
    }
  }, 30_000);

  test("removing section clears crewId from archived workspaces", async () => {
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

    // Create a section
    const sectionResult = await env.orpc.projects.crews.create({
      projectPath,
      name: `test-section-archive-${Date.now()}`,
    });
    expect(sectionResult.success).toBe(true);
    const sectionId = sectionResult.success ? sectionResult.data.id : "";

    // Create a workspace in that section
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("archive-section-test"),
      trunkBranch,
      crewId: sectionId,
    });
    expect(wsResult.success).toBe(true);
    const workspaceId = wsResult.success ? wsResult.metadata.id : "";

    try {
      // Archive the workspace
      const archiveResult = await env.orpc.minion.archive({ minionId: workspaceId });
      expect(archiveResult.success).toBe(true);

      // Verify workspace is archived and has sectionId
      let wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.crewId).toBe(sectionId);
      expect(wsInfo?.archivedAt).toBeDefined();

      // Now remove the section - should succeed since workspace is archived
      const removeResult = await env.orpc.projects.crews.remove({
        projectPath,
        crewId: sectionId,
      });
      expect(removeResult.success).toBe(true);

      // Verify workspace's sectionId is now cleared
      wsInfo = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfo).not.toBeNull();
      expect(wsInfo?.crewId).toBeUndefined();
    } finally {
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      // Section already removed in test, but try anyway in case test failed early
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId }).catch(() => {});
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Section Deletion Confirmation Flow
  // ─────────────────────────────────────────────────────────────────────────────

  test("clicking delete on section with active workspaces confirms and unsections workspaces", async () => {
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

    // Create a section
    const sectionResult = await env.orpc.projects.crews.create({
      projectPath,
      name: `test-delete-confirm-${Date.now()}`,
    });
    expect(sectionResult.success).toBe(true);
    const sectionId = sectionResult.success ? sectionResult.data.id : "";

    // Create a workspace in that section (active, not archived)
    const wsResult = await env.orpc.minion.create({
      projectPath,
      branchName: generateBranchName("in-section-delete-confirm"),
      trunkBranch,
      crewId: sectionId,
    });
    expect(wsResult.success).toBe(true);
    const workspaceId = wsResult.success ? wsResult.metadata.id : "";
    const metadata = wsResult.success ? wsResult.metadata : setupWs.metadata;

    const cleanupDom = installDom();
    expandProjects([projectPath]);

    const view = renderApp({ apiClient: env.orpc, metadata });

    try {
      await setupWorkspaceView(view, metadata, workspaceId);

      // Wait for section and workspace to appear in UI as sectioned
      await waitForCrew(view.container, sectionId);
      const workspaceRowBeforeDelete = findWorkspaceRow(view.container, workspaceId);
      expect(workspaceRowBeforeDelete).not.toBeNull();
      expect(workspaceRowBeforeDelete?.getAttribute("data-crew-id")).toBe(sectionId);

      // Find and click the delete button on the section
      const sectionElement = view.container.querySelector(`[data-crew-id="${sectionId}"]`);
      expect(sectionElement).not.toBeNull();

      // Hover over section to reveal action buttons (they're only visible on hover)
      fireEvent.mouseEnter(sectionElement!);

      const deleteButton = sectionElement!.querySelector('[aria-label="Delete section"]');
      expect(deleteButton).not.toBeNull();
      fireEvent.click(deleteButton!);

      // Confirm the deletion warning for active workspaces
      const confirmDialog = await waitFor(
        () => {
          const dialog = view.container.ownerDocument.body.querySelector('[role="dialog"]');
          if (!dialog) throw new Error("Delete confirmation dialog not found");

          const dialogText = dialog.textContent ?? "";
          if (!dialogText.includes("Delete section?")) {
            throw new Error(`Expected delete confirmation title, got: ${dialogText}`);
          }
          if (!dialogText.includes("will be moved to unsectioned")) {
            throw new Error(`Expected unsection warning, got: ${dialogText}`);
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
          const removedSection = view.container.querySelector(`[data-crew-id="${sectionId}"]`);
          if (removedSection) throw new Error("Section was not removed from the sidebar");
        },
        { timeout: 5_000 }
      );

      // Workspace should remain but become unsectioned
      await waitFor(
        () => {
          const workspaceRow = findWorkspaceRow(view.container, workspaceId);
          if (!workspaceRow) throw new Error("Workspace row not found after deleting section");

          const updatedSectionId = workspaceRow.getAttribute("data-crew-id");
          if (updatedSectionId !== "") {
            throw new Error(
              `Expected workspace to be unsectioned, got data-crew-id=${updatedSectionId}`
            );
          }
        },
        { timeout: 5_000 }
      );

      // Backend should reflect the unsectioned workspace as well
      const wsInfoAfterDelete = await env.orpc.minion.getInfo({ minionId: workspaceId });
      expect(wsInfoAfterDelete).not.toBeNull();
      expect(wsInfoAfterDelete?.crewId).toBeUndefined();
    } finally {
      await cleanupView(view, cleanupDom);
      await env.orpc.minion.remove({ minionId: workspaceId });
      await env.orpc.minion.remove({ minionId: setupWs.metadata.id });
      await env.orpc.projects.crews.remove({ projectPath, crewId: sectionId }).catch(() => {});
    }
  }, 60_000);
});
