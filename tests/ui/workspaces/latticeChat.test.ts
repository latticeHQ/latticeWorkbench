/**
 * UI integration tests for the built-in "Chat with Lattice" system workspace.
 *
 * These tests validate:
 * - App boots into /workspace/lattice-chat instead of the Welcome screen.
 * - Clicking the Lattice logo navigates to /workspace/lattice-chat.
 * - Chat with Lattice is permanent: no Archive button + Ctrl+N does not start workspace creation.
 */

import "../dom";
import { act, fireEvent, waitFor } from "@testing-library/react";

import { createTestEnvironment, cleanupTestEnvironment, preloadTestModules } from "../../ipc/setup";
import { cleanupTempGitRepo, createTempGitRepo, generateBranchName } from "../../ipc/helpers";

import { detectDefaultTrunkBranch } from "@/node/git";
import { getLatticeHelpChatProjectPath } from "@/node/constants/latticeChat";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";

import { installDom } from "../dom";
import { renderApp } from "../renderReviewPanel";
import { cleanupView, setupWorkspaceView } from "../helpers";

async function waitForWorkspaceChatToRender(container: HTMLElement): Promise<void> {
  await waitFor(
    () => {
      const messageWindow = container.querySelector('[data-testid="message-window"]');
      if (!messageWindow) {
        throw new Error("Workspace chat view not rendered yet");
      }
    },
    { timeout: 30_000 }
  );
}

describe("Chat with Lattice system workspace (UI)", () => {
  beforeAll(async () => {
    await preloadTestModules();
  });

  test("boots into Chat with Lattice (no Welcome screen)", async () => {
    const env = await createTestEnvironment();
    const cleanupDom = installDom();

    const view = renderApp({ apiClient: env.orpc });

    try {
      await view.waitForReady();
      await waitForWorkspaceChatToRender(view.container);

      expect(window.location.pathname).toBe(`/workspace/${LATTICE_HELP_CHAT_MINION_ID}`);
      expect(view.queryByText("Welcome to Lattice")).toBeNull();

      // On first boot, the lattice-chat workspace should seed a synthetic welcome message.
      await waitFor(
        () => {
          expect(view.container.querySelector('[data-message-id="lattice-chat-welcome"]')).toBeTruthy();
        },
        { timeout: 30_000 }
      );
    } finally {
      await cleanupView(view, cleanupDom);
      await cleanupTestEnvironment(env);
    }
  }, 60_000);

  test("Lattice logo navigates back to Chat with Lattice", async () => {
    const env = await createTestEnvironment();
    const repoPath = await createTempGitRepo();
    const cleanupDom = installDom();

    const workspaceIdToRemove: string[] = [];
    let view: ReturnType<typeof renderApp> | undefined;

    try {
      const trunkBranch = await detectDefaultTrunkBranch(repoPath);
      const branchName = generateBranchName("lattice-chat-ui");

      const createResult = await env.orpc.minion.create({
        projectPath: repoPath,
        branchName,
        trunkBranch,
      });

      if (!createResult.success) {
        throw new Error(`Failed to create workspace: ${createResult.error}`);
      }

      const wsId = createResult.metadata.id;
      workspaceIdToRemove.push(wsId);

      view = renderApp({ apiClient: env.orpc });
      await view.waitForReady();

      await setupWorkspaceView(view, createResult.metadata, wsId);
      await waitForWorkspaceChatToRender(view.container);

      expect(window.location.pathname).toBe(`/workspace/${encodeURIComponent(wsId)}`);

      const logoButton = view.container.querySelector(
        'button[aria-label="Open Chat with Lattice"]'
      ) as HTMLElement | null;
      if (!logoButton) {
        throw new Error("Lattice logo button not found");
      }

      await act(async () => {
        fireEvent.click(logoButton);
      });

      await waitFor(
        () => {
          expect(window.location.pathname).toBe(`/workspace/${LATTICE_HELP_CHAT_MINION_ID}`);
        },
        { timeout: 10_000 }
      );
    } finally {
      if (view) {
        await cleanupView(view, cleanupDom);
      } else {
        cleanupDom();
      }

      for (const workspaceId of workspaceIdToRemove) {
        try {
          await env.orpc.minion.remove({ minionId: workspaceId, options: { force: true } });
        } catch {
          // Best effort.
        }
      }

      await cleanupTestEnvironment(env);
      await cleanupTempGitRepo(repoPath);
    }
  }, 60_000);

  test("Chat with Lattice is permanent (no Archive button; Ctrl+N does nothing)", async () => {
    const env = await createTestEnvironment();
    const cleanupDom = installDom();

    const view = renderApp({ apiClient: env.orpc });

    try {
      await view.waitForReady();
      await waitForWorkspaceChatToRender(view.container);

      // The system project itself should be hidden from the sidebar projects list.
      const systemProjectPath = getLatticeHelpChatProjectPath(env.config.rootDir);
      await waitFor(
        () => {
          expect(
            view.container.querySelector(`[data-project-path="${systemProjectPath}"]`)
          ).toBeNull();
        },
        { timeout: 10_000 }
      );

      // Chat with Lattice is no longer rendered as a WorkspaceListItem in the sidebar;
      // it's accessed via the Lattice logo / help icon in the header. Verify no workspace
      // row exists for it (which means no Archive button by design).
      expect(
        view.container.querySelector(`[data-workspace-id="${LATTICE_HELP_CHAT_MINION_ID}"]`)
      ).toBeNull();

      // Ctrl+N should not redirect to /project when lattice-chat is selected.
      await act(async () => {
        fireEvent.keyDown(window, { key: "n", ctrlKey: true });
      });

      await new Promise((r) => setTimeout(r, 200));
      expect(window.location.pathname).toBe(`/workspace/${LATTICE_HELP_CHAT_MINION_ID}`);
    } finally {
      await cleanupView(view, cleanupDom);
      await cleanupTestEnvironment(env);
    }
  }, 30_000);
});
