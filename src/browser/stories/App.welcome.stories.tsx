/**
 * Welcome/Empty state and minion creation stories
 */

import { within, userEvent, waitFor, expect } from "@storybook/test";

import { appMeta, AppWithMocks, type AppStory } from "./meta.js";
import { createMockORPCClient, type MockSessionUsage } from "@/browser/stories/mocks/orpc";
import { expandProjects } from "./storyHelpers";
import { createArchivedMinion, NOW } from "./mockFactory";
import type { ProjectConfig } from "@/node/config";

/** Helper to create session usage data with a specific total cost */
function createSessionUsage(cost: number): MockSessionUsage {
  // Distribute cost across components realistically
  const inputCost = cost * 0.55;
  const outputCost = cost * 0.25;
  const cachedCost = cost * 0.15;
  const reasoningCost = cost * 0.05;

  return {
    byModel: {
      "claude-sonnet-4-20250514": {
        input: { tokens: Math.round(inputCost * 2000), cost_usd: inputCost },
        cached: { tokens: Math.round(cachedCost * 2000), cost_usd: cachedCost },
        cacheCreate: { tokens: 0, cost_usd: 0 },
        output: { tokens: Math.round(outputCost * 500), cost_usd: outputCost },
        reasoning: { tokens: Math.round(reasoningCost * 1000), cost_usd: reasoningCost },
        model: "claude-sonnet-4-20250514",
      },
    },
    version: 1,
  };
}

async function openFirstProjectCreationView(storyRoot: HTMLElement): Promise<void> {
  // App now boots into the built-in lattice-chat minion.
  // Navigate to the first project's creation page so creation/banner UI is visible.
  const projectRow = await waitFor(
    () => {
      const el = storyRoot.querySelector("[data-project-path][aria-controls]");
      if (!el) throw new Error("Project row not found");
      return el;
    },
    { timeout: 10_000 }
  );

  await userEvent.click(projectRow);
}
export default {
  ...appMeta,
  title: "App/Welcome",
};

/** Chat with Lattice - the default boot state (no user projects) */
export const ChatWithLattice: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() =>
        createMockORPCClient({
          projects: new Map(),
          minions: [],
        })
      }
    />
  ),
};

/** Helper to create a project config for a path with no minions */
function projectWithNoMinions(path: string): [string, ProjectConfig] {
  return [path, { minions: [] }];
}

/** Creation view - shown when a project exists but no minion is selected */
export const CreateMinion: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
  },
};

/** Creation view with multiple projects - shows sidebar with projects */
export const CreateMinionMultipleProjects: AppStory = {
  parameters: {
    chromatic: {
      modes: {
        dark: { theme: "dark" },
        light: { theme: "light" },
        "dark-mobile": { theme: "dark", viewport: "mobile1", hasTouch: true },
        "light-mobile": { theme: "light", viewport: "mobile1", hasTouch: true },
      },
    },
  },
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects([
          "/Users/dev/frontend-app",
          "/Users/dev/backend-api",
          "/Users/dev/mobile-client",
        ]);
        return createMockORPCClient({
          projects: new Map([
            projectWithNoMinions("/Users/dev/frontend-app"),
            projectWithNoMinions("/Users/dev/backend-api"),
            projectWithNoMinions("/Users/dev/mobile-client"),
          ]),
          minions: [],
        });
      }}
    />
  ),
};

/**
 * Non-git repository - shows git init banner prompting user to initialize git.
 * Banner is displayed above the ChatInput when the project directory is not a git repo.
 */
export const NonGitRepository: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/new-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/new-project")]),
          minions: [],
          // Return empty branches (indicates non-git repo)
          listBranches: () => Promise.resolve({ branches: [], recommendedTrunk: null }),
          // Mark non-local runtimes as unavailable for non-git repos
          // Dev container hidden (no config found) rather than disabled
          runtimeAvailability: {
            local: { available: true },
            worktree: { available: false, reason: "Requires git repository" },
            ssh: { available: false, reason: "Requires git repository" },
            docker: { available: false, reason: "Requires git repository" },
            devcontainer: { available: false, reason: "No devcontainer.json found" },
          },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the banner to appear and scroll into view
    const banner = await canvas.findByTestId("git-init-banner", {}, { timeout: 10000 });
    banner.scrollIntoView({ block: "center" });
  },
};

/**
 * Non-git repository success flow - demonstrates clicking "Run git init"
 * which shows a success message explaining Worktree and Remote are now available.
 */
export const NonGitRepositorySuccess: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/new-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/new-project")]),
          minions: [],
          // Always return empty branches so banner stays visible after success
          listBranches: () => Promise.resolve({ branches: [], recommendedTrunk: null }),
          // Mark non-local runtimes as unavailable for non-git repos
          // Dev container hidden (no config found) rather than disabled
          runtimeAvailability: {
            local: { available: true },
            worktree: { available: false, reason: "Requires git repository" },
            ssh: { available: false, reason: "Requires git repository" },
            docker: { available: false, reason: "Requires git repository" },
            devcontainer: { available: false, reason: "No devcontainer.json found" },
          },
          // Simulate git init success
          gitInit: () => Promise.resolve({ success: true as const }),
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the banner to appear
    const banner = await canvas.findByTestId("git-init-banner", {}, { timeout: 10000 });
    banner.scrollIntoView({ block: "center" });

    // Click the git init button to trigger success flow
    const button = await canvas.findByTestId("git-init-button");
    await userEvent.click(button);

    // Wait for success message to appear
    await waitFor(() => {
      if (!canvas.queryByTestId("git-init-success")) {
        throw new Error("Success message not visible");
      }
    });
  },
};

/**
 * Non-git repository with in-progress state - demonstrates the loading UI
 * while git init is running.
 */
export const NonGitRepositoryInProgress: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/new-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/new-project")]),
          minions: [],
          listBranches: () => Promise.resolve({ branches: [], recommendedTrunk: null }),
          // Dev container hidden (no config found) rather than disabled
          runtimeAvailability: {
            local: { available: true },
            worktree: { available: false, reason: "Requires git repository" },
            ssh: { available: false, reason: "Requires git repository" },
            docker: { available: false, reason: "Requires git repository" },
            devcontainer: { available: false, reason: "No devcontainer.json found" },
          },
          // Never resolve - keeps in loading state
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          gitInit: () => new Promise(() => {}),
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the banner to appear
    const banner = await canvas.findByTestId("git-init-banner", {}, { timeout: 10000 });
    banner.scrollIntoView({ block: "center" });

    // Click the button to trigger loading state
    const button = await canvas.findByTestId("git-init-button");
    await userEvent.click(button);

    // Verify loading state is shown
    await waitFor(() => {
      if (!canvas.queryByText("Running...")) {
        throw new Error("Loading state not visible");
      }
    });
  },
};

/**
 * Non-git repository with error state - demonstrates the error message
 * when git init fails.
 */
export const NonGitRepositoryError: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/new-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/new-project")]),
          minions: [],
          listBranches: () => Promise.resolve({ branches: [], recommendedTrunk: null }),
          // Dev container hidden (no config found) rather than disabled
          runtimeAvailability: {
            local: { available: true },
            worktree: { available: false, reason: "Requires git repository" },
            ssh: { available: false, reason: "Requires git repository" },
            docker: { available: false, reason: "Requires git repository" },
            devcontainer: { available: false, reason: "No devcontainer.json found" },
          },
          // Return error
          gitInit: () =>
            Promise.resolve({
              success: false as const,
              error: "Permission denied: cannot write to /Users/dev/new-project",
            }),
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the banner to appear
    const banner = await canvas.findByTestId("git-init-banner", {}, { timeout: 10000 });
    banner.scrollIntoView({ block: "center" });

    // Click the button to trigger error
    const button = await canvas.findByTestId("git-init-button");
    await userEvent.click(button);

    // Verify error message is shown
    await waitFor(() => {
      if (!canvas.queryByTestId("git-init-error")) {
        throw new Error("Error message not visible");
      }
    });
  },
};

/**
 * Docker unavailable - demonstrates the UI when Docker daemon is not running.
 * The Docker button should be greyed out with a tooltip explaining why.
 */
export const DockerUnavailable: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/new-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/new-project")]),
          minions: [],
          // Docker unavailable, but git repo exists
          // Dev container hidden (no config found) rather than disabled
          runtimeAvailability: {
            local: { available: true },
            worktree: { available: true },
            ssh: { available: true },
            docker: { available: false, reason: "Docker daemon not running" },
            devcontainer: { available: false, reason: "No devcontainer.json found" },
          },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for minion type buttons to appear
    await canvas.findByText("Minion Type", {}, { timeout: 10000 });

    // Wait for Docker button to become disabled (runtimeAvailability loads async)
    await waitFor(async () => {
      const dockerButton = canvas.getByRole("button", { name: /Docker/i });
      await expect(dockerButton).toBeDisabled();
    });
  },
};

/** Helper to generate archived minions with varied dates for timeline grouping */
function generateBenchedMinions(projectPath: string, projectName: string) {
  const MINUTE = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;

  const minions: Array<ReturnType<typeof createArchivedMinion>> = [];
  const sessionUsage = new Map<string, MockSessionUsage>();

  // Intentionally large set to exercise ProjectPage scrolling + bulk selection UX.
  // Keep timestamps deterministic (based on NOW constant).
  for (let i = 0; i < 34; i++) {
    const n = i + 1;

    // Mix timeframes:
    // - first ~6: today (minutes/hours)
    // - next ~8: last week
    // - next ~10: last month
    // - remaining: older (spans multiple month/year buckets)
    let archivedDeltaMs: number;
    if (n <= 3) {
      archivedDeltaMs = n * 15 * MINUTE;
    } else if (n <= 6) {
      archivedDeltaMs = n * 2 * HOUR;
    } else if (n <= 14) {
      archivedDeltaMs = n * DAY;
    } else if (n <= 24) {
      archivedDeltaMs = n * 3 * DAY;
    } else {
      // Older: jump further back to create multiple month/year group headers
      archivedDeltaMs = (n - 10) * 15 * DAY;
    }

    const kind = n % 6;
    const name =
      kind === 0
        ? `feature/batch-${n}`
        : kind === 1
          ? `bugfix/issue-${n}`
          : kind === 2
            ? `refactor/cleanup-${n}`
            : kind === 3
              ? `chore/deps-${n}`
              : kind === 4
                ? `feature/ui-${n}`
                : `bugfix/regression-${n}`;

    const id = `archived-${n}`;
    minions.push(
      createArchivedMinion({
        id,
        name,
        projectName,
        projectPath,
        archivedAt: new Date(NOW - archivedDeltaMs).toISOString(),
      })
    );

    // Generate varied costs: some cheap ($0.05-$0.50), some expensive ($1-$5)
    // Skip some minions to show missing cost data
    if (n % 4 !== 0) {
      const baseCost = n % 3 === 0 ? 1.5 + (n % 7) * 0.5 : 0.1 + (n % 5) * 0.08;
      sessionUsage.set(id, createSessionUsage(baseCost));
    }
  }

  return { minions, sessionUsage };
}

/**
 * Project page with archived minions - demonstrates:
 * - Timeline grouping (Today, Yesterday, This Week, etc.)
 * - Cost display per minion, per time bucket, and total
 * - Search bar (visible with >3 minions)
 * - Bulk selection with checkboxes
 * - Select all checkbox
 * - Restore and delete actions
 */
export const ProjectPageWithBenchedMinions: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        const { minions, sessionUsage } = generateBenchedMinions(
          "/Users/dev/my-project",
          "my-project"
        );
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions,
          sessionUsage,
        });
      }}
    />
  ),
};

/**
 * No providers configured - shows the configure providers prompt.
 * This is displayed instead of ChatInput when the user hasn't set up any API keys.
 */
export const NoProvidersConfigured: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          // Empty providers config - no API keys set
          providersConfig: {},
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the configure prompt to appear
    await canvas.findByTestId("configure-providers-prompt", {}, { timeout: 10000 });
  },
};

/**
 * Single provider configured - shows the provider bar with one icon and ChatInput.
 */
export const SingleProviderConfigured: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          providersConfig: {
            anthropic: { apiKeySet: true, isEnabled: true, isConfigured: true },
          },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the provider bar to appear (it contains "Providers" settings link)
    await waitFor(
      () => {
        if (!canvas.queryByText("Providers")) {
          throw new Error("Provider bar not visible");
        }
      },
      { timeout: 10000 }
    );
  },
};

/**
 * Multiple providers configured - shows the provider bar with multiple icons.
 */
export const MultipleProvidersConfigured: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        expandProjects(["/Users/dev/my-project"]);
        return createMockORPCClient({
          projects: new Map([projectWithNoMinions("/Users/dev/my-project")]),
          minions: [],
          providersConfig: {
            anthropic: { apiKeySet: true, isEnabled: true, isConfigured: true },
            openai: { apiKeySet: true, isEnabled: true, isConfigured: true },
            google: { apiKeySet: true, isEnabled: true, isConfigured: true },
            xai: { apiKeySet: true, isEnabled: true, isConfigured: true },
          },
        });
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const storyRoot = document.getElementById("storybook-root") ?? canvasElement;
    await openFirstProjectCreationView(storyRoot);
    const canvas = within(storyRoot);

    // Wait for the provider bar to appear
    await waitFor(
      () => {
        if (!canvas.queryByText("Providers")) {
          throw new Error("Provider bar not visible");
        }
      },
      { timeout: 10000 }
    );
  },
};
