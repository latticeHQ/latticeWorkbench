/**
 * Electron Preload Script
 *
 * This script bridges the renderer process with the main process via ORPC over MessagePort.
 *
 * Key responsibilities:
 * 1) Forward MessagePort from renderer to main process for ORPC transport setup
 * 2) Expose minimal platform info to renderer via contextBridge
 *
 * The ORPC connection flow:
 * - Renderer creates MessageChannel, posts "start-orpc-client" with serverPort
 * - Preload intercepts, forwards serverPort to main via ipcRenderer.postMessage
 * - Main process upgrades the port with RPCHandler for bidirectional RPC
 *
 * Build: `bun build src/desktop/preload.ts --format=cjs --target=node --external=electron`
 */

import { contextBridge, ipcRenderer } from "electron";
import type { LatticeDeepLinkPayload } from "@/common/types/deepLink";

// lattice:// deep links can arrive before the React app subscribes.
// Buffer them here so the renderer can consume them on mount.
const pendingDeepLinks: LatticeDeepLinkPayload[] = [];
const deepLinkSubscribers = new Set<(payload: LatticeDeepLinkPayload) => void>();

ipcRenderer.on("lattice:deep-link", (_event: unknown, payload: LatticeDeepLinkPayload) => {
  if (deepLinkSubscribers.size === 0) {
    pendingDeepLinks.push(payload);
  }

  for (const subscriber of deepLinkSubscribers) {
    try {
      subscriber(payload);
    } catch (error) {
      // Best-effort: a renderer bug shouldn't break deep link delivery.
      console.debug("[deep-link] Renderer subscriber threw:", error);
    }
  }
});

// Forward ORPC MessagePort from renderer to main process
window.addEventListener("message", (event) => {
  if (event.data === "start-orpc-client" && event.ports?.[0]) {
    ipcRenderer.postMessage("start-orpc-server", null, [...event.ports]);
  }
});

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  isE2E: process.env.LATTICE_E2E === "1",
  enableReactPerfProfile: process.env.LATTICE_PROFILE_REACT === "1",
  enableTelemetryInDev: process.env.LATTICE_ENABLE_TELEMETRY_IN_DEV === "1",
  // Note: When debugging LLM requests, we also want to see synthetic/request-only
  // messages in the chat history so the UI matches what was sent to the provider.
  debugLlmRequest: process.env.LATTICE_DEBUG_LLM_REQUEST === "1",
  // Allow testing against a lattice.md staging/local deployment without rebuilding the renderer.
  latticeMdUrlOverride: process.env.LATTICE_MD_URL_OVERRIDE,
  // NOTE: This is intentionally async so the preload script does not rely on Node builtins
  // like `child_process` (which can break in hardened/sandboxed environments).
  getIsRosetta: () => ipcRenderer.invoke("lattice:get-is-rosetta"),
  getIsWindowsWslShell: () => ipcRenderer.invoke("lattice:get-is-windows-wsl-shell"),
  // Register a callback for notification clicks (navigates to minion)
  // Returns an unsubscribe function.
  onNotificationClicked: (callback: (data: { minionId: string }) => void) => {
    const listener = (_event: unknown, data: { minionId: string }) => callback(data);
    ipcRenderer.on("lattice:notification-clicked", listener);
    return () => {
      ipcRenderer.off("lattice:notification-clicked", listener);
    };
  },
  consumePendingDeepLinks: () => pendingDeepLinks.splice(0, pendingDeepLinks.length),
  onDeepLink: (callback: (payload: LatticeDeepLinkPayload) => void) => {
    deepLinkSubscribers.add(callback);
    return () => {
      deepLinkSubscribers.delete(callback);
    };
  },
});
