/**
 * Lattice workspace integration stories.
 * Tests the UI for creating and connecting to Lattice cloud workspaces.
 */

import { within, userEvent, waitFor } from "@storybook/test";

import { appMeta, AppWithMocks, type AppStory } from "./meta.js";
import { createMockORPCClient } from "@/browser/stories/mocks/orpc";
import { expandProjects } from "./storyHelpers";
import type { ProjectConfig } from "@/node/config";
import type { LatticeTemplate, LatticePreset, LatticeWorkspace } from "@/common/orpc/schemas/lattice";

async function openProjectCreationView(storyRoot: HTMLElement): Promise<void> {
  // App now boots into the built-in lattice-chat workspace.
  // Navigate to the project creation page so runtime controls are visible.
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

/** Helper to create a project config for a path with no workspaces */
function projectWithNoWorkspaces(path: string): [string, ProjectConfig] {
  return [path, { workspaces: [] }];
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

/** Mock existing Lattice workspaces */
const mockWorkspaces: LatticeWorkspace[] = [
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

/**
 * SSH runtime with Lattice available - shows Lattice checkbox.
 * When user selects SSH runtime, they can enable Lattice workspace mode.
 */
export const SSHWithLatticeAvailable: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
          latticeInfo: { state: "available", version: "2.28.0" },
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeWorkspaces: mockWorkspaces,
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // Wait for SSH mode to be active and Lattice checkbox to appear
    await waitFor(
      () => {
        const latticeCheckbox = canvas.queryByTestId("lattice-checkbox");
        if (!latticeCheckbox) throw new Error("Lattice checkbox not found");
      },
      { timeout: 5000 }
    );
  },
};

/**
 * Lattice new workspace flow - shows template and preset dropdowns.
 * User enables Lattice, selects template, and optionally a preset.
 */
export const LatticeNewWorkspace: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
          latticeInfo: { state: "available", version: "2.28.0" },
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeWorkspaces: mockWorkspaces,
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // Enable Lattice
    const latticeCheckbox = await canvas.findByTestId("lattice-checkbox", {}, { timeout: 5000 });
    await userEvent.click(latticeCheckbox);

    // Wait for Lattice controls to appear
    await canvas.findByTestId("lattice-controls-inner", {}, { timeout: 5000 });

    // The template dropdown should be visible with templates loaded
    await canvas.findByTestId("lattice-template-select", {}, { timeout: 5000 });
  },
};

/**
 * Lattice existing workspace flow - shows workspace dropdown.
 * User switches to "Existing" mode and selects from running workspaces.
 */
export const LatticeExistingWorkspace: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
          latticeInfo: { state: "available", version: "2.28.0" },
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
            ["aws-windows", []],
          ]),
          latticeWorkspaces: mockWorkspaces,
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // Enable Lattice
    const latticeCheckbox = await canvas.findByTestId("lattice-checkbox", {}, { timeout: 5000 });
    await userEvent.click(latticeCheckbox);

    // Wait for Lattice controls
    await canvas.findByTestId("lattice-controls-inner", {}, { timeout: 5000 });

    // Click "Existing" button
    const existingButton = canvas.getByRole("button", { name: "Existing" });
    await userEvent.click(existingButton);

    // Wait for workspace dropdown to appear
    await canvas.findByTestId("lattice-workspace-select", {}, { timeout: 5000 });
  },
};

/**
 * Lattice not available - checkbox should not appear.
 * When Lattice CLI is not installed, the SSH runtime shows normal host input.
 */
export const LatticeNotAvailable: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
          latticeInfo: { state: "unavailable", reason: "missing" },
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // SSH host input should appear (normal SSH mode)
    await waitFor(
      () => {
        const hostInput = canvas.queryByPlaceholderText("user@host");
        if (!hostInput) throw new Error("SSH host input not found");
      },
      { timeout: 5000 }
    );

    // Lattice checkbox should NOT appear
    const latticeCheckbox = canvas.queryByTestId("lattice-checkbox");
    if (latticeCheckbox) {
      throw new Error("Lattice checkbox should not appear when Lattice is unavailable");
    }
  },
};

/**
 * Lattice CLI outdated - checkbox appears but is disabled with tooltip.
 * When Lattice CLI is installed but version is below minimum, shows explanation.
 */
export const LatticeOutdated: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // Lattice checkbox should appear but be disabled
    const latticeCheckbox = await canvas.findByTestId("lattice-checkbox", {}, { timeout: 5000 });
    await waitFor(() => {
      if (!(latticeCheckbox instanceof HTMLInputElement)) {
        throw new Error("Lattice checkbox should be an input element");
      }
      if (!latticeCheckbox.disabled) {
        throw new Error("Lattice checkbox should be disabled when CLI is outdated");
      }
      if (latticeCheckbox.checked) {
        throw new Error("Lattice checkbox should be unchecked when CLI is outdated");
      }
    });

    // Hover over checkbox to trigger tooltip
    await userEvent.hover(latticeCheckbox.parentElement!);

    // Wait for tooltip to appear with version info
    await waitFor(
      () => {
        const tooltip = document.querySelector('[role="tooltip"]');
        if (!tooltip) throw new Error("Tooltip not found");
        if (!tooltip.textContent?.includes("2.20.0")) {
          throw new Error("Tooltip should mention the current CLI version");
        }
        if (!tooltip.textContent?.includes("2.25.0")) {
          throw new Error("Tooltip should mention the minimum required version");
        }
      },
      { timeout: 5000 }
    );
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
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
          latticeInfo: { state: "available", version: "2.28.0" },
          latticeTemplates: [
            { name: "simple-vm", displayName: "Simple VM", organizationName: "default" },
          ],
          latticePresets: new Map([["simple-vm", []]]),
          latticeWorkspaces: [],
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // Enable Lattice
    const latticeCheckbox = await canvas.findByTestId("lattice-checkbox", {}, { timeout: 5000 });
    await userEvent.click(latticeCheckbox);

    // Wait for Lattice controls
    await canvas.findByTestId("lattice-controls-inner", {}, { timeout: 5000 });

    // Template dropdown should be visible
    await canvas.findByTestId("lattice-template-select", {}, { timeout: 5000 });

    // Preset dropdown should be visible but disabled (shows "No presets" placeholder)
    const presetSelect = await canvas.findByTestId("lattice-preset-select", {}, { timeout: 5000 });
    await waitFor(() => {
      // Radix UI Select sets data-disabled="" (empty string) when disabled
      if (!presetSelect.hasAttribute("data-disabled")) {
        throw new Error("Preset dropdown should be disabled when template has no presets");
      }
    });
  },
};

/**
 * Lattice with no running workspaces.
 * When switching to "Existing" mode with no running workspaces, shows empty state.
 */
export const LatticeNoRunningWorkspaces: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoWorkspaces("/Users/dev/my-project")]),
          workspaces: [],
          latticeInfo: { state: "available", version: "2.28.0" },
          latticeTemplates: mockTemplates,
          latticePresets: new Map([
            ["lattice-on-lattice", mockPresetsLatticeOnLattice],
            ["kubernetes-dev", mockPresetsK8s],
          ]),
          latticeWorkspaces: [], // No running workspaces
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

    // Click SSH runtime button
    const sshButton = canvas.getByRole("button", { name: /SSH/i });
    await userEvent.click(sshButton);

    // Enable Lattice
    const latticeCheckbox = await canvas.findByTestId("lattice-checkbox", {}, { timeout: 5000 });
    await userEvent.click(latticeCheckbox);

    // Click "Existing" button
    const existingButton = await canvas.findByRole(
      "button",
      { name: "Existing" },
      { timeout: 5000 }
    );
    await userEvent.click(existingButton);

    // Workspace dropdown should show "No workspaces found" placeholder
    // Note: Radix UI Select doesn't render native <option> elements - the placeholder
    // text appears directly in the SelectTrigger element
    const workspaceSelect = await canvas.findByTestId(
      "lattice-workspace-select",
      {},
      { timeout: 5000 }
    );
    await waitFor(() => {
      const triggerText = workspaceSelect.textContent;
      if (!triggerText?.includes("No workspaces found")) {
        throw new Error("Should show 'No workspaces found' placeholder");
      }
    });
  },
};
