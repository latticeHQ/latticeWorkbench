import type { ComponentType } from "react";
import { within, userEvent, waitFor } from "@storybook/test";

import type { APIClient } from "@/browser/contexts/API";
import { updatePersistedState } from "@/browser/hooks/usePersistedState";
import {
  WORKBENCH_PANEL_TAB_KEY,
  WORKBENCH_PANEL_WIDTH_KEY,
  getPostCompactionStateKey,
  getWorkbenchPanelLayoutKey,
} from "@/common/constants/storage";
import assert from "@/common/utils/assert";

import { appMeta, AppWithMocks, type AppStory } from "./meta.js";
import { createAssistantMessage, createUserMessage } from "./mockFactory";
import { expandWorkbenchPanel, setupSimpleChatStory } from "./storyHelpers";

const PLAN_PREVIEW_MINION_ID = "ws-plan-preview";
const PLAN_PREVIEW_PATH = "/home/user/.lattice/plans/my-app/ws-plan-preview.md";
const PLAN_PREVIEW_CONTENT = `# Plan preview modal story

- Show the preserved plan directly in the workbench panel flow.
- Keep open-in-editor as a secondary action.
- Verify markdown remains readable in a dialog.`;

function configurePlanArtifactMocks(client: APIClient): void {
  const excludedItems = new Set<string>();

  client.minion.getPostCompactionState = (input) => {
    assert(input.minionId === PLAN_PREVIEW_MINION_ID, "Unexpected minion in story mock");

    return Promise.resolve({
      planPath: PLAN_PREVIEW_PATH,
      trackedFilePaths: ["src/browser/components/WorkbenchPanel/PostCompactionSection.tsx"],
      excludedItems: Array.from(excludedItems),
    });
  };

  client.minion.setPostCompactionExclusion = (input) => {
    assert(input.minionId === PLAN_PREVIEW_MINION_ID, "Unexpected minion in story mock");

    if (input.excluded) {
      excludedItems.add(input.itemId);
    } else {
      excludedItems.delete(input.itemId);
    }

    return Promise.resolve({ success: true as const, data: undefined });
  };

  client.minion.getPlanContent = (input) => {
    assert(input.minionId === PLAN_PREVIEW_MINION_ID, "Unexpected minion in story mock");

    return Promise.resolve({
      success: true as const,
      data: {
        content: PLAN_PREVIEW_CONTENT,
        path: PLAN_PREVIEW_PATH,
      },
    });
  };
}

export default {
  ...appMeta,
  title: "App/WorkbenchPanel/Plan Preview",
  decorators: [
    (Story: ComponentType) => (
      <div style={{ width: 1600, height: "100dvh" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    ...appMeta.parameters,
    chromatic: {
      ...(appMeta.parameters?.chromatic ?? {}),
      modes: {
        dark: { theme: "dark", viewport: 1600 },
        light: { theme: "light", viewport: 1600 },
      },
    },
  },
};

export const PlanPreviewModal: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        localStorage.setItem(WORKBENCH_PANEL_TAB_KEY, JSON.stringify("costs"));
        localStorage.setItem(WORKBENCH_PANEL_WIDTH_KEY, "420");
        localStorage.removeItem(getWorkbenchPanelLayoutKey(PLAN_PREVIEW_MINION_ID));

        updatePersistedState(getPostCompactionStateKey(PLAN_PREVIEW_MINION_ID), {
          planPath: PLAN_PREVIEW_PATH,
          trackedFilePaths: ["src/browser/components/WorkbenchPanel/PostCompactionSection.tsx"],
          excludedItems: [],
        });

        const client = setupSimpleChatStory({
          minionId: PLAN_PREVIEW_MINION_ID,
          minionName: "feature/plan-preview",
          projectName: "my-app",
          messages: [
            createUserMessage("msg-1", "compact this chat and keep important context", {
              historySequence: 1,
            }),
            createAssistantMessage("msg-2", "Compaction completed and artifacts were saved.", {
              historySequence: 2,
            }),
          ],
        });

        configurePlanArtifactMocks(client);
        expandWorkbenchPanel();
        return client;
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    const artifactsButton = await canvas.findByRole("button", { name: "Artifacts" });
    await userEvent.click(artifactsButton);

    const planFileButton = await canvas.findByRole("button", { name: "Plan file" });
    await userEvent.click(planFileButton);

    await waitFor(() => {
      body.getByText("Plan preview modal story");
      body.getByText(PLAN_PREVIEW_PATH);
    });
  },
};
