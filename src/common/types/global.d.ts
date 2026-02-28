import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import type { LatticeDeepLinkPayload } from "@/common/types/deepLink";

// Our simplified permission modes for UI
export type UIPermissionMode = "plan" | "edit";

// Claude SDK permission modes
export type SDKPermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

declare global {
  interface WindowApi {
    platform: NodeJS.Platform;
    versions: {
      node?: string;
      chrome?: string;
      electron?: string;
    };
    // Optional lattice.md base URL override (passed through Electron preload).
    latticeMdUrlOverride?: string;
    // Debug flags (dev-only, passed through preload)
    debugLlmRequest?: boolean;
    // Allow maintainers to opt into telemetry while running the dev server.
    enableTelemetryInDev?: boolean;
    // E2E test mode flag - used to adjust UI behavior (e.g., longer toast durations)
    isE2E?: boolean;
    // Enables in-app React.Profiler capture for automated perf tests.
    enableReactPerfProfile?: boolean;
    // True if running under Rosetta 2 translation on Apple Silicon (storybook/tests may set this)
    isRosetta?: boolean;
    // Async getter (used in Electron) for environments where preload cannot use Node builtins
    getIsRosetta?: () => Promise<boolean>;
    // True if Windows appears to be configured to use WSL as the default shell.
    isWindowsWslShell?: boolean;
    // Async getter (Electron) for Windows environments where WSL may win PATH.
    getIsWindowsWslShell?: () => Promise<boolean>;
    // Register a callback for notification clicks (navigates to minion)
    // Returns an unsubscribe function.
    onNotificationClicked?: (callback: (data: { minionId: string }) => void) => () => void;
    // Consume any lattice:// deep links received before the renderer subscribed.
    consumePendingDeepLinks?: () => LatticeDeepLinkPayload[];
    // Subscribe to lattice:// deep links as they arrive. Returns an unsubscribe function.
    onDeepLink?: (callback: (payload: LatticeDeepLinkPayload) => void) => () => void;
    // Optional ORPC-backed API surfaces populated in tests/storybook mocks
    tokenizer?: unknown;
    providers?: unknown;
    nameGeneration?: unknown;
    minion?: unknown;
    projects?: unknown;
    window?: unknown;
    terminal?: unknown;
    update?: unknown;
    server?: unknown;
  }

  interface Window {
    api?: WindowApi;
    __ORPC_CLIENT__?: RouterClient<AppRouter>;
    process?: {
      env?: Record<string, string | undefined>;
    };
  }

  /**
   * Optional lattice.md base URL override injected by Vite (`define`) in dev-server browser mode.
   *
   * This intentionally lives on `globalThis` so shared code (compiled for Node as CJS) doesn't need
   * to rely on `import.meta.env`.
   */
  var __LATTICE_MD_URL_OVERRIDE__: string | undefined;
}

export {};
