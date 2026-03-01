/**
 * usePixelHQBridge — React hook that wires the MinionPixelBridge
 * into the component lifecycle.
 *
 * Connects Lattice Workbench contexts (MinionContext, ProjectContext)
 * and the MinionStore to the bridge, which in turn mutates the
 * OfficeState for the pixel engine renderer.
 *
 * Subscriptions:
 * 1. minionMetadata + projects -> bridge.syncMinions()
 * 2. Per-minion MinionStore state -> bridge.syncMinionState() / syncToolState()
 * 3. Per-minion usage data -> bridge.syncCost()
 *
 * All subscriptions are cleaned up on unmount.
 */

import { useRef, useEffect, useMemo } from "react";
import { MinionPixelBridge } from "./MinionPixelBridge";
import { OfficeState } from "../engine/officeState";
import { useMinionContext } from "@/browser/contexts/MinionContext";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useMinionStoreRaw } from "@/browser/stores/MinionStore";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { getTotalCost } from "@/common/utils/tokens/usageAggregator";
import { isMinionArchived } from "@/common/utils/archive";

/**
 * Create and manage a MinionPixelBridge that synchronizes Lattice
 * application state into the pixel office OfficeState.
 *
 * The bridge instance is stable across re-renders (held in a ref).
 * Three effect groups keep it in sync:
 *
 * 1. **Minion lifecycle** — watches minionMetadata and project crews,
 *    filters by projectPath, and calls `bridge.syncMinions()`.
 *
 * 2. **Per-minion streaming state** — for each active minion in the
 *    project, subscribes to MinionStore via `store.subscribeKey()` and
 *    calls `bridge.syncMinionState()` and `bridge.syncToolState()`.
 *
 * 3. **Per-minion cost** — subscribes to usage data via
 *    `store.subscribeUsage()` and calls `bridge.syncCost()`.
 *
 * @param projectPath - The project path to filter minions for
 * @param officeState - The OfficeState instance to mutate
 * @returns The stable MinionPixelBridge instance
 */
export function usePixelHQBridge(
  projectPath: string,
  officeState: OfficeState,
): MinionPixelBridge {
  const bridgeRef = useRef<MinionPixelBridge | null>(null);

  // Create or replace bridge when officeState changes
  if (!bridgeRef.current || bridgeRef.current["officeState"] !== officeState) {
    bridgeRef.current?.dispose();
    bridgeRef.current = new MinionPixelBridge(officeState);
  }

  const bridge = bridgeRef.current;
  const { minionMetadata } = useMinionContext();
  const { projects } = useProjectContext();
  const store = useMinionStoreRaw();

  // ── Derive project-scoped minions and crews ──
  const { activeMinions, archivedMinions, crews } = useMemo(() => {
    const active: FrontendMinionMetadata[] = [];
    const archived: FrontendMinionMetadata[] = [];

    for (const minion of minionMetadata.values()) {
      if (minion.projectPath !== projectPath) continue;
      if (isMinionArchived(minion.archivedAt, minion.unarchivedAt)) {
        archived.push(minion);
      } else {
        active.push(minion);
      }
    }

    const projectConfig = projects.get(projectPath);
    const projectCrews = projectConfig?.crews ?? [];

    return {
      activeMinions: active,
      archivedMinions: archived,
      crews: projectCrews,
    };
  }, [minionMetadata, projects, projectPath]);

  // ── Effect 1: Sync minion lifecycle (adds/removes/room changes) ──
  useEffect(() => {
    bridge.syncMinions(activeMinions, crews, archivedMinions);
  }, [bridge, activeMinions, crews, archivedMinions]);

  // ── Effect 2: Per-minion state subscriptions (streaming, tools) ──
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    for (const minion of activeMinions) {
      const minionId = minion.id;

      // Subscribe to MinionStore state changes
      const unsubState = store.subscribeKey(minionId, () => {
        const state = store.getMinionState(minionId);
        bridge.syncMinionState(minionId, {
          canInterrupt: state.canInterrupt,
          isStreamStarting: state.isStreamStarting,
          awaitingUserQuestion: state.awaitingUserQuestion,
          lastAbortReason: state.lastAbortReason,
        });

        // Derive current tool from the last pending tool message.
        // When a tool call is in progress, the last message will be a
        // "tool" type with isStreaming=true. When it completes or no tool
        // is running, we clear the tool state.
        const messages = state.messages;
        let currentTool: string | null = null;
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (
            lastMsg.type === "tool" &&
            "isStreaming" in lastMsg &&
            lastMsg.isStreaming &&
            "toolName" in lastMsg
          ) {
            currentTool = lastMsg.toolName as string;
          }
        }
        bridge.syncToolState(minionId, currentTool);
      });

      unsubscribers.push(unsubState);
    }

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [bridge, store, activeMinions]);

  // ── Effect 3: Per-minion cost subscriptions ──
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    for (const minion of activeMinions) {
      const minionId = minion.id;

      const unsubUsage = store.subscribeUsage(minionId, () => {
        const usage = store.getMinionUsage(minionId);
        const cost = getTotalCost(usage.sessionTotal);
        if (cost !== undefined) {
          bridge.syncCost(minionId, cost);
        }
      });

      unsubscribers.push(unsubUsage);
    }

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [bridge, store, activeMinions]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      bridgeRef.current?.dispose();
    };
  }, []);

  return bridge;
}
