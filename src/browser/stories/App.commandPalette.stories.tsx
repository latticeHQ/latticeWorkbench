/**
 * Minion switcher stories - tests the command palette in various visual states.
 *
 * Shows command palette with minion entries where:
 * - Title (if set) is the primary label
 * - Name + project shown as subtitle
 * - Keywords enable matching by title, name, or project
 *
 * Stories:
 * - WithTitles: 8 minions across 3 projects, mix of titled/untitled, various ages
 * - FuzzySearch: Same rich set with a partial search query pre-typed to show filtering
 * - ManyMinions: 14 minions across 5 projects to stress-test scrolling/grouping
 */

import { expect, userEvent, within } from "@storybook/test";
import { appMeta, AppWithMocks, type AppStory } from "./meta.js";
import { NOW, createMinion, groupMinionsByProject } from "./mockFactory";
import { selectMinion, collapseWorkbenchPanel, expandProjects } from "./storyHelpers";
import { createMockORPCClient } from "@/browser/stories/mocks/orpc";
import type { FrontendMinionMetadata } from "@/common/types/minion";

export default {
  ...appMeta,
  title: "App/MinionSwitcher",
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared minion fixtures
// ─────────────────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 8 minions across 3 projects — a realistic daily driver set */
function createRichMinions(): FrontendMinionMetadata[] {
  return [
    // ── my-app (3 minions) ──────────────────────────────────────────────
    createMinion({
      id: "ws-myapp-fix-login",
      name: "fix/login-button",
      projectName: "my-app",
      title: "Fix login button styling issue",
      createdAt: new Date(NOW - 1 * HOUR).toISOString(),
    }),
    createMinion({
      id: "ws-myapp-auth",
      name: "feature/auth",
      projectName: "my-app",
      // no title — branch name is primary
      createdAt: new Date(NOW - 4 * HOUR).toISOString(),
    }),
    createMinion({
      id: "ws-myapp-refactor",
      name: "refactor/api-layer",
      projectName: "my-app",
      title: "Refactor API layer to use new error handling patterns",
      createdAt: new Date(NOW - 2 * DAY).toISOString(),
    }),

    // ── backend-api (3 minions) ─────────────────────────────────────────
    createMinion({
      id: "ws-backend-perf",
      name: "perf/query-cache",
      projectName: "backend-api",
      title: "Add query-level caching for dashboard endpoints",
      createdAt: new Date(NOW - 30 * 60_000).toISOString(), // 30 min ago
    }),
    createMinion({
      id: "ws-backend-main",
      name: "main",
      projectName: "backend-api",
      // no title — trunk branch
      createdAt: new Date(NOW - 5 * DAY).toISOString(),
    }),
    createMinion({
      id: "ws-backend-migration",
      name: "chore/db-migration",
      projectName: "backend-api",
      title: "Migrate users table to new schema",
      createdAt: new Date(NOW - 12 * HOUR).toISOString(),
    }),

    // ── docs-site (2 minions) ───────────────────────────────────────────
    createMinion({
      id: "ws-docs-quickstart",
      name: "docs/quickstart-guide",
      projectName: "docs-site",
      title: "Rewrite quickstart guide for v2",
      createdAt: new Date(NOW - 3 * HOUR).toISOString(),
    }),
    createMinion({
      id: "ws-docs-main",
      name: "main",
      projectName: "docs-site",
      // no title
      createdAt: new Date(NOW - 7 * DAY).toISOString(),
    }),
  ];
}

/** Helper: set up common story scaffolding (select, sidebar, projects) */
function setupStory(minions: FrontendMinionMetadata[]) {
  const projects = groupMinionsByProject(minions);
  selectMinion(minions[0]);
  collapseWorkbenchPanel();
  expandProjects([...projects.keys()]);
  return createMockORPCClient({ projects, minions });
}

/** Helper: wait for the app to render then open the command palette */
async function openPalette(canvasElement: HTMLElement, waitForText: string) {
  const canvas = within(canvasElement);
  await expect(canvas.findByText(waitForText, {}, { timeout: 5000 })).resolves.toBeTruthy();
  await userEvent.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Command palette showing 8 minions across 3 projects.
 *
 * Demonstrates title-first hierarchy:
 * - Minions with titles show the title as primary label
 * - Minions without titles show the branch name as primary
 * - Mix of recent and older minions shows age diversity
 */
export const WithTitles: AppStory = {
  render: () => <AppWithMocks setup={() => setupStory(createRichMinions())} />,
  play: async ({ canvasElement }) => {
    await openPalette(canvasElement, "Fix login button styling issue");
  },
};

/**
 * Command palette with a fuzzy search query pre-typed.
 *
 * Types "refac" into the palette input to show:
 * - Fuzzy matching against titles, branch names, and project names
 * - Filtered result list with highlighted matches
 */
export const FuzzySearch: AppStory = {
  render: () => <AppWithMocks setup={() => setupStory(createRichMinions())} />,
  play: async ({ canvasElement }) => {
    await openPalette(canvasElement, "Fix login button styling issue");

    // Type a partial query to trigger fuzzy filtering
    await userEvent.keyboard("refac");
  },
};

/**
 * Command palette with 14 minions across 5 projects.
 *
 * Stress-tests:
 * - Scroll behavior when many items overflow the palette
 * - Project grouping with many crews
 * - Visual density at scale
 */
export const ManyMinions: AppStory = {
  render: () => (
    <AppWithMocks
      setup={() => {
        const minions: FrontendMinionMetadata[] = [
          // ── my-app (3) ───────────────────────────────────────────────────
          createMinion({
            id: "ws-many-myapp-1",
            name: "fix/login-button",
            projectName: "my-app",
            title: "Fix login button styling issue",
            createdAt: new Date(NOW - 1 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-myapp-2",
            name: "feature/dark-mode",
            projectName: "my-app",
            title: "Implement dark mode toggle",
            createdAt: new Date(NOW - 6 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-myapp-3",
            name: "main",
            projectName: "my-app",
            createdAt: new Date(NOW - 10 * DAY).toISOString(),
          }),

          // ── backend-api (3) ──────────────────────────────────────────────
          createMinion({
            id: "ws-many-backend-1",
            name: "perf/query-cache",
            projectName: "backend-api",
            title: "Add query-level caching for dashboard endpoints",
            createdAt: new Date(NOW - 2 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-backend-2",
            name: "fix/rate-limiter",
            projectName: "backend-api",
            title: "Fix rate limiter race condition under load",
            createdAt: new Date(NOW - 1 * DAY).toISOString(),
          }),
          createMinion({
            id: "ws-many-backend-3",
            name: "chore/db-migration",
            projectName: "backend-api",
            createdAt: new Date(NOW - 3 * DAY).toISOString(),
          }),

          // ── docs-site (3) ────────────────────────────────────────────────
          createMinion({
            id: "ws-many-docs-1",
            name: "docs/quickstart-guide",
            projectName: "docs-site",
            title: "Rewrite quickstart guide for v2",
            createdAt: new Date(NOW - 3 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-docs-2",
            name: "docs/api-reference",
            projectName: "docs-site",
            title: "Auto-generate API reference from OpenAPI spec",
            createdAt: new Date(NOW - 8 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-docs-3",
            name: "main",
            projectName: "docs-site",
            createdAt: new Date(NOW - 14 * DAY).toISOString(),
          }),

          // ── infra-tools (3) ──────────────────────────────────────────────
          createMinion({
            id: "ws-many-infra-1",
            name: "feature/terraform-modules",
            projectName: "infra-tools",
            title: "Extract shared Terraform modules for ECS",
            createdAt: new Date(NOW - 5 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-infra-2",
            name: "fix/ci-pipeline",
            projectName: "infra-tools",
            title: "Fix flaky CI pipeline timeout on ARM runners",
            createdAt: new Date(NOW - 2 * DAY).toISOString(),
          }),
          createMinion({
            id: "ws-many-infra-3",
            name: "main",
            projectName: "infra-tools",
            createdAt: new Date(NOW - 30 * DAY).toISOString(),
          }),

          // ── design-system (2) ────────────────────────────────────────────
          createMinion({
            id: "ws-many-design-1",
            name: "feature/color-tokens",
            projectName: "design-system",
            title: "Migrate color palette to design tokens",
            createdAt: new Date(NOW - 4 * HOUR).toISOString(),
          }),
          createMinion({
            id: "ws-many-design-2",
            name: "fix/button-variants",
            projectName: "design-system",
            createdAt: new Date(NOW - 9 * HOUR).toISOString(),
          }),
        ];

        return setupStory(minions);
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await openPalette(canvasElement, "Fix login button styling issue");
  },
};
