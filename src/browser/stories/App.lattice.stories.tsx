/**
 * Lattice minion integration stories.
 * Tests the UI for creating and connecting to Lattice cloud minions.
 */

import { within, userEvent, waitFor } from "@storybook/test";

import { appMeta, AppWithMocks, type AppStory } from "./meta.js";
import { createMockORPCClient } from "@/browser/stories/mocks/orpc";
import { expandProjects } from "./storyHelpers";
import type { ProjectConfig } from "@/node/config";
import type { LatticeTemplate, LatticePreset, LatticeMinion } from "@/common/orpc/schemas/lattice";
import { getLastRuntimeConfigKey, getRuntimeKey } from "@/common/constants/storage";

async function openProjectCreationView(storyRoot: HTMLElement): Promise<void> {
  // App now boots into the built-in lattice-chat minion.
  // Navigate to the project creation page so runtime controls are visible.
  if (typeof localStorage !== "undefined") {
    // Ensure runtime selection state doesn't leak between stories.
    localStorage.removeItem(getLastRuntimeConfigKey("/Users/dev/my-project"));
    localStorage.removeItem(getRuntimeKey("/Users/dev/my-project"));
  }

  const projectRow = await waitFor(
    () => {
      const el = storyRoot.querySelector(
        '[data-project-path="/Users/dev/my-project"][aria-controls]'
      );
      if (!el) throw new Error("Project row not found");
      return el;
    },
    { timeout: 10_000 }
  );

  await userEvent.click(projectRow);
}
export default {
  ...appMeta,
  title: "App/Lattice",
};

/** Helper to create a project config for a path with no minions */
function projectWithNoMinions(path: string): [string, ProjectConfig] {
  return [path, { minions: [] }];
}

/** Mock Lattice templates */
const mockTemplates: LatticeTemplate[] = [
  {
    name: "lattice-on-lattice",
    displayName: "Lattice on Lattice",
    organizationName: "default",
  },
  {
    name: "kubernetes-dev",
    displayName: "Kubernetes Development",
    organizationName: "default",
  },
  {
    name: "aws-windows",
    displayName: "AWS Windows Instance",
    organizationName: "default",
  },
];

/** Mock presets for lattice-on-lattice template */
const mockPresetsLatticeOnLattice: LatticePreset[] = [
  {
    id: "preset-sydney",
    name: "Sydney",
    description: "Australia region",
    isDefault: false,
  },
  {
    id: "preset-helsinki",
    name: "Helsinki",
    description: "Europe region",
    isDefault: false,
  },
  {
    id: "preset-pittsburgh",
    name: "Pittsburgh",
    description: "US East region",
    isDefault: true,
  },
];

/** Mock presets for kubernetes template (only one) */
const mockPresetsK8s: LatticePreset[] = [
  {
    id: "preset-k8s-1",
    name: "Standard",
    description: "Default configuration",
    isDefault: true,
  },
];

/** Mock existing Lattice minions */
const mockMinions: LatticeMinion[] = [
  {
    name: "lattice-dev",
    templateName: "lattice-on-lattice",
    templateDisplayName: "Lattice on Lattice",
    status: "running",
  },
  {
    name: "api-testing",
    templateName: "kubernetes-dev",
    templateDisplayName: "Kubernetes Dev",
    status: "running",
  },
  {
    name: "frontend-v2",
    templateName: "lattice-on-lattice",
    templateDisplayName: "Lattice on Lattice",
    status: "running",
  },
];

const mockParseError = "Unexpected token u in JSON at position 0";

const mockLatticeInfo = {
  state: "available" as const,
  version: "2.28.0",
  // Include username + URL so Storybook renders the logged-in label in Lattice stories.
  username: "lattice-user",
  url: "https://lattice.example.com",
};

/**
 * Lattice available - shows Lattice runtime button.
 * When Lattice CLI is available, the Lattice button appears in the runtime selector.
 */
export const SSHWithLatticeAvailable: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeMinions: mockMinions,
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the runtime button group to appear
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Lattice button should appear when Lattice CLI is available
    await canvas.findByRole("button", { name: /Lattice/i });
  },
};

/**
 * Lattice new minion flow - shows template and preset dropdowns.
 * User clicks Lattice runtime button, then selects template and optionally a preset.
 */
export const LatticeNewMinion: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeMinions: mockMinions,
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Wait for Lattice controls to appear
    await canvas.findByTestId("lattice-controls-inner");

    // The template dropdown should be visible with templates loaded
    await canvas.findByTestId("lattice-template-select");
  },
};

/**
 * Lattice existing minion flow - shows minion dropdown.
 * User clicks Lattice runtime, switches to "Existing" mode and selects from running minions.
 */
export const LatticeExistingMinion: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeMinions: mockMinions,
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Wait for Lattice controls
    await canvas.findByTestId("lattice-controls-inner");

    // Click "Existing" button — use findByRole (retry-capable) to handle
    // transient DOM gaps between awaits.
    const existingButton = await canvas.findByRole("button", { name: "Existing" });
    await userEvent.click(existingButton);

    // Wait for minion dropdown to appear
    await canvas.findByTestId("lattice-minion-select");
  },
};

/**
 * Lattice existing minion flow with parse error.
 * Shows the error state when listing minions fails to parse.
 */
export const LatticeExistingMinionParseError: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeMinions: mockMinions,
          latticeMinionsResult: { ok: false, error: mockParseError },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Wait for Lattice controls
    await canvas.findByTestId("lattice-controls-inner");

    // Click "Existing" button — use findByRole (retry-capable) to handle
    // transient DOM gaps between awaits.
    const existingButton = await canvas.findByRole("button", { name: "Existing" });
    await userEvent.click(existingButton);

    // Error message should appear for minion listing
    await canvas.findByText(mockParseError);
  },
};

/**
 * Lattice new minion flow with template parse error.
 * Shows the error state when listing templates fails to parse.
 */
export const LatticeTemplatesParseError: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplatesResult: { ok: false, error: mockParseError },
          latticeMinions: mockMinions,
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Wait for Lattice controls
    await canvas.findByTestId("lattice-controls-inner");

    await canvas.findByText(mockParseError);

    // Re-query inside waitFor to avoid stale DOM refs after React re-renders.
    await waitFor(() => {
      const templateSelect = canvas.queryByTestId("lattice-template-select");
      if (!templateSelect?.hasAttribute("data-disabled")) {
        throw new Error("Template dropdown should be disabled when templates fail to load");
      }
    });
  },
};

/**
 * Lattice new minion flow with preset parse error.
 * Shows the error state when listing presets fails to parse.
 */
export const LatticePresetsParseError: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticePresetsResult: new Map([["lattice-on-lattice", { ok: false, error: mockParseError }]]),
          latticeMinions: mockMinions,
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Wait for Lattice controls and template select
    await canvas.findByTestId("lattice-controls-inner");
    await canvas.findByTestId("lattice-template-select");

    await canvas.findByText(mockParseError);
  },
};

/**
 * Lattice not available - Lattice button should not appear.
 * When Lattice CLI is not installed, the runtime selector only shows SSH (no Lattice).
 */
export const LatticeNotAvailable: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: { state: "unavailable", reason: "missing" },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls to load
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // SSH button should be present
    await canvas.findByRole("button", { name: /SSH/i });

    // Lattice button should NOT appear when Lattice CLI is unavailable
    const latticeButton = canvas.queryByRole("button", { name: /Lattice/i });
    if (latticeButton) {
      throw new Error("Lattice button should not appear when Lattice CLI is unavailable");
    }
  },
};

/**
 * Lattice CLI outdated - Lattice button appears but is disabled with tooltip.
 * When Lattice CLI is installed but version is below minimum, shows explanation on hover.
 */
export const LatticeOutdated: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: { state: "outdated", version: "2.20.0", minVersion: "2.25.0" },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Lattice button should appear but be disabled.
    // Re-query inside waitFor to avoid stale DOM refs after React re-renders.
    await waitFor(() => {
      const btn = canvas.queryByRole("button", { name: /Lattice/i });
      if (!btn?.hasAttribute("disabled")) {
        throw new Error("Lattice button should be disabled when CLI is outdated");
      }
    });

    // Hover over Lattice button to trigger tooltip with version error.
    // Use findByRole (retry-capable) to handle transient DOM gaps between awaits.
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.hover(latticeButton);

    // Wait for tooltip to appear with version info
    await waitFor(() => {
      const tooltip = document.querySelector('[role="tooltip"]');
      if (!tooltip) throw new Error("Tooltip not found");
      if (!tooltip.textContent?.includes("2.20.0")) {
        throw new Error("Tooltip should mention the current CLI version");
      }
      if (!tooltip.textContent?.includes("2.25.0")) {
        throw new Error("Tooltip should mention the minimum required version");
      }
    });
  },
};

/**
 * Lattice with template that has no presets.
 * When selecting a template with 0 presets, the preset dropdown is visible but disabled.
 */
export const LatticeNoPresets: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: [
            { name: "simple-vm", displayName: "Simple VM", organizationName: "default" },
          ],
          latticePresets: new Map([["simple-vm", []]]),
          latticeMinions: [],
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Wait for Lattice controls
    await canvas.findByTestId("lattice-controls-inner");

    // Template dropdown should be visible
    await canvas.findByTestId("lattice-template-select");

    // Preset dropdown should be visible but disabled (shows "No presets" placeholder).
    // Re-query inside waitFor to avoid stale DOM refs after React re-renders.
    await waitFor(() => {
      // Radix UI Select sets data-disabled="" (empty string) when disabled
      const presetSelect = canvas.queryByTestId("lattice-preset-select");
      if (!presetSelect?.hasAttribute("data-disabled")) {
        throw new Error("Preset dropdown should be disabled when template has no presets");
      }
    });
  },
};

/**
 * Lattice with no running minions.
 * When switching to "Existing" mode with no running minions, shows empty state.
 */
export const LatticeNoRunningMinions: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          latticeInfo: mockLatticeInfo,
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
          ]),
          latticeMinions: [], // No running minions
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for runtime controls
    await canvas.findByRole("group", { name: "Runtime type" }, { timeout: 10000 });

    // Click Lattice runtime button directly
    const latticeButton = await canvas.findByRole("button", { name: /Lattice/i });
    await userEvent.click(latticeButton);

    // Click "Existing" button
    const existingButton = await canvas.findByRole("button", { name: "Existing" });
    await userEvent.click(existingButton);

    // Minion dropdown should show "No minions found" placeholder.
    // Note: Radix UI Select doesn't render native <option> elements - the placeholder
    // text appears directly in the SelectTrigger element.
    // Re-query inside waitFor to avoid stale DOM refs after React re-renders.
    await waitFor(() => {
      const minionSelect = canvas.queryByTestId("lattice-minion-select");
      if (!minionSelect?.textContent?.includes("No minions found")) {
        throw new Error("Should show 'No minions found' placeholder");
      }
    });
  },
};
