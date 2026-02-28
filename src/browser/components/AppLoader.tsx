import { useState, useEffect } from "react";
import App from "../App";
import { AuthTokenModal } from "./AuthTokenModal";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LoadingScreen } from "./LoadingScreen";
import { StartupConnectionError } from "./StartupConnectionError";
import { useMinionStoreRaw, minionStore } from "../stores/MinionStore";
import { useGitStatusStoreRaw } from "../stores/GitStatusStore";
import { useBackgroundBashStoreRaw } from "../stores/BackgroundBashStore";
import { getPRStatusStoreInstance } from "../stores/PRStatusStore";
import { ProjectProvider, useProjectContext } from "../contexts/ProjectContext";
import { PolicyProvider, usePolicy } from "@/browser/contexts/PolicyContext";
import { PolicyBlockedScreen } from "@/browser/components/PolicyBlockedScreen";
import { APIProvider, useAPI, type APIClient } from "@/browser/contexts/API";
import { MinionProvider, useMinionContext } from "../contexts/MinionContext";
import { RouterProvider } from "../contexts/RouterContext";
import { TelemetryEnabledProvider } from "../contexts/TelemetryEnabledContext";
import { TerminalRouterProvider } from "../terminal/TerminalRouterContext";

interface AppLoaderProps {
  /** Optional pre-created ORPC api?. If provided, skips internal connection setup. */
  client?: APIClient;
}

/**
 * AppLoader handles all initialization before rendering the main App:
 * 1. Load minion metadata and projects (via contexts)
 * 2. Sync stores with loaded data
 * 3. Only render App when everything is ready
 *
 * MinionContext handles minion selection restoration from URL.
 * RouterProvider must wrap MinionProvider since minion state is derived from URL.
 * MinionProvider must be nested inside ProjectProvider so it can call useProjectContext().
 * This ensures App.tsx can assume stores are always synced and removes
 * the need for conditional guards in effects.
 */
export function AppLoader(props: AppLoaderProps) {
  return (
    <ThemeProvider>
      <APIProvider client={props.client}>
        <PolicyProvider>
          <RouterProvider>
            <ProjectProvider>
              <MinionProvider>
                <AppLoaderInner />
              </MinionProvider>
            </ProjectProvider>
          </RouterProvider>
        </PolicyProvider>
      </APIProvider>
    </ThemeProvider>
  );
}

/**
 * Inner component that has access to both ProjectContext and MinionContext.
 * Syncs stores and shows loading screen until ready.
 */
function AppLoaderInner() {
  const policyState = usePolicy();
  const minionContext = useMinionContext();
  const projectContext = useProjectContext();
  const apiState = useAPI();
  const api = apiState.api;

  // Get store instances
  const minionStoreInstance = useMinionStoreRaw();
  const gitStatusStore = useGitStatusStoreRaw();
  const backgroundBashStore = useBackgroundBashStoreRaw();

  // Track whether stores have been synced
  const [storesSynced, setStoresSynced] = useState(false);

  // Track whether the initial load has completed. After the first successful
  // load, we keep rendering the UI during reconnects instead of flashing the
  // full-screen LoadingScreen again.
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Sync stores when metadata finishes loading
  useEffect(() => {
    // Keep store clients in sync even during backend restarts (api can be null while reconnecting).
    minionStoreInstance.setClient(api ?? null);
    gitStatusStore.setClient(api ?? null);
    backgroundBashStore.setClient(api ?? null);
    getPRStatusStoreInstance().setClient(api ?? null);

    if (!minionContext.loading) {
      minionStoreInstance.syncMinions(minionContext.minionMetadata);
      gitStatusStore.syncMinions(minionContext.minionMetadata);

      // Wire up file-modification subscription (idempotent - only subscribes once)
      gitStatusStore.subscribeToFileModifications((listener) =>
        minionStore.subscribeFileModifyingTool(listener)
      );

      setStoresSynced(true);
    } else {
      setStoresSynced(false);
    }
  }, [
    minionContext.loading,
    minionContext.minionMetadata,
    minionStoreInstance,
    gitStatusStore,
    backgroundBashStore,
    api,
  ]);

  useEffect(() => {
    if (initialLoadComplete) {
      return;
    }

    if (!projectContext.loading && !minionContext.loading && storesSynced) {
      setInitialLoadComplete(true);
    }
  }, [initialLoadComplete, projectContext.loading, storesSynced, minionContext.loading]);

  if (policyState.status.state === "blocked") {
    return <PolicyBlockedScreen reason={policyState.status.reason} />;
  }

  // If we're in browser mode and auth is required, show the token prompt before any data loads.
  if (apiState.status === "auth_required") {
    return (
      <AuthTokenModal
        isOpen={true}
        onSubmit={apiState.authenticate}
        onSessionAuthenticated={apiState.retry}
        error={apiState.error}
      />
    );
  }

  // Only block the UI during the very first load. After that, keep rendering the
  // last-known UI during reconnects so we don't flash the LoadingScreen again.
  if (!initialLoadComplete) {
    if (apiState.status === "error") {
      return <StartupConnectionError error={apiState.error} onRetry={apiState.retry} />;
    }

    const statusText =
      apiState.status === "reconnecting"
        ? `Reconnecting to backend (attempt ${apiState.attempt})...`
        : "Rallying minions...";

    return <LoadingScreen statusText={statusText} />;
  }

  // Render App - all state available via contexts
  return (
    <TelemetryEnabledProvider>
      <TerminalRouterProvider>
        <App />
      </TerminalRouterProvider>
    </TelemetryEnabledProvider>
  );
}
