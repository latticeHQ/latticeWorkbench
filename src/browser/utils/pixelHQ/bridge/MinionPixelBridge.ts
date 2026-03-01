/**
 * Minion Pixel Bridge
 *
 * Central adapter that translates Lattice Workbench state changes into
 * OfficeState mutations for the Pixel HQ visualization engine.
 *
 * The bridge sits between React (MinionContext, ProjectContext, MinionStore)
 * and the imperative OfficeState, keeping the pixel office in sync with
 * the application's minion lifecycle, streaming state, tool execution,
 * and cost tracking.
 */

import { OfficeState } from "../engine/officeState";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { CrewConfig } from "@/common/types/project";
import type { RoomZone } from "../engine/types";
import { assignRoom } from "./roomAssignment";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Cost thresholds (USD) at which to show a cost_warning bubble */
const COST_THRESHOLDS = [1, 5, 10] as const;

/** Number of distinct palette variants available for character sprites */
const PALETTE_COUNT = 6;

// ─────────────────────────────────────────────────────────────────────────────
// MinionPixelBridge
// ─────────────────────────────────────────────────────────────────────────────

export class MinionPixelBridge {
  private officeState: OfficeState;

  /** Tracks which room each known minion is assigned to: minionId -> roomId */
  private knownMinions = new Map<string, string>();

  /** Rotating palette index for assigning sprite variants to new agents */
  private paletteCounter = 0;

  /** Tracks which cost thresholds have already triggered a bubble per minion */
  private costWarningShown = new Set<string>();

  constructor(officeState: OfficeState) {
    this.officeState = officeState;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Minion Lifecycle Sync
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Synchronize the full set of minions with the pixel office.
   *
   * Called when MinionContext.minionMetadata or ProjectContext.projects change.
   * Diffs the current known set against the new set and applies mutations:
   * - New minions: addAgent() to the correct room
   * - Removed minions: removeAgent()
   * - Archived minions: move to bench_lounge
   * - Crew changes: reassign to the new crew room
   *
   * @param activeMinions - Currently active (non-archived) minions
   * @param crews - Crew configurations for the current project
   * @param archivedMinions - Archived minions that should appear in bench_lounge
   */
  syncMinions(
    activeMinions: FrontendMinionMetadata[],
    crews: CrewConfig[],
    archivedMinions: FrontendMinionMetadata[],
  ): void {
    const rooms = this.officeState.layout.rooms;
    const allMinions = [...activeMinions, ...archivedMinions];
    const currentIds = new Set(allMinions.map((m) => m.id));

    // ── Remove minions that are no longer present ──
    for (const [minionId] of this.knownMinions) {
      if (!currentIds.has(minionId)) {
        this.officeState.removeAgent(minionId);
        this.knownMinions.delete(minionId);
        // Clean up all cost threshold entries for this minion
        for (const threshold of COST_THRESHOLDS) {
          this.costWarningShown.delete(`${minionId}:${threshold}`);
        }
      }
    }

    // ── Add or update each minion ──
    for (const minion of allMinions) {
      const assignment = assignRoom(minion, rooms);
      const previousRoomId = this.knownMinions.get(minion.id);

      if (previousRoomId === undefined) {
        // New minion -- add to the office
        const hueShift = this.getCrewHueShift(minion.crewId ?? null, crews);
        this.officeState.addAgent({
          id: minion.id,
          minionId: minion.id,
          displayName: minion.title ?? minion.name,
          tileCol: 0,
          tileRow: 0,
          palette: this.nextPalette(),
          hueShift,
          crewId: minion.crewId ?? null,
          withSpawnEffect: true,
        });

        // Assign to the correct room
        this.officeState.assignCharacterToRoom(
          minion.id,
          assignment.roomZone as RoomZone,
          minion.crewId,
        );

        this.knownMinions.set(minion.id, assignment.roomId);
      } else if (previousRoomId !== assignment.roomId) {
        // Room changed -- reassign (crew change, archived, etc.)
        this.officeState.assignCharacterToRoom(
          minion.id,
          assignment.roomZone as RoomZone,
          minion.crewId,
        );

        // Update hue shift if crew changed
        const char = this.officeState.characters.get(minion.id);
        if (char) {
          char.hueShift = this.getCrewHueShift(minion.crewId ?? null, crews);
          char.crewId = minion.crewId ?? null;
        }

        this.knownMinions.set(minion.id, assignment.roomId);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-Minion State Sync
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Synchronize a single minion's MinionStore state to the pixel office.
   *
   * Called when MinionStore state changes for a specific minion (via
   * subscribeKey). Maps application state to pixel engine mutations:
   * - canInterrupt -> setAgentActive (minion is streaming)
   * - awaitingUserQuestion -> showBubble('waiting')
   * - lastAbortReason -> showBubble('error')
   *
   * @param minionId - The minion ID
   * @param state - Subset of MinionState relevant to visualization
   */
  syncMinionState(
    minionId: string,
    state: {
      canInterrupt: boolean;
      isStreamStarting: boolean;
      awaitingUserQuestion: boolean;
      lastAbortReason: unknown;
    },
  ): void {
    // Active state: minion is streaming (canInterrupt) or starting
    const isActive = state.canInterrupt || state.isStreamStarting;
    this.officeState.setAgentActive(minionId, isActive);

    // Bubble: awaiting user input
    if (state.awaitingUserQuestion) {
      this.officeState.showBubble(minionId, "waiting");
    }

    // Bubble: abort/error
    if (state.lastAbortReason) {
      this.officeState.showBubble(minionId, "error");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool State Sync
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Synchronize the current tool execution state for a minion.
   *
   * Called when a tool call starts or ends. Maps the tool name to the
   * character's work animation (e.g., Read/Grep -> READ, Edit/Bash -> TYPE).
   *
   * @param minionId - The minion ID
   * @param toolName - The tool name, or null if no tool is active
   */
  syncToolState(minionId: string, toolName: string | null): void {
    this.officeState.setAgentTool(minionId, toolName);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cost Tracking
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check cost thresholds and show warning bubbles at milestones.
   *
   * Tracks which thresholds have been shown per minion to avoid
   * repeated warnings. Shows a cost_warning bubble when a threshold
   * is crossed for the first time.
   *
   * @param minionId - The minion ID
   * @param totalCost - Cumulative USD cost for this minion
   */
  syncCost(minionId: string, totalCost: number): void {
    for (const threshold of COST_THRESHOLDS) {
      const key = `${minionId}:${threshold}`;
      if (totalCost >= threshold && !this.costWarningShown.has(key)) {
        this.costWarningShown.add(key);
        this.officeState.showBubble(minionId, "cost_warning");
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Appearance Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compute a hue shift value based on crew color.
   *
   * Parses the crew's hex color into an HSL hue. If no crew or no color
   * is set, returns 0 (no shift). This is used to tint crew members'
   * sprites so they are visually grouped.
   *
   * @param crewId - The crew ID, or null
   * @param crews - Array of crew configurations
   * @returns Hue shift in degrees (0-360), or 0 if no crew color
   */
  private getCrewHueShift(crewId: string | null, crews: CrewConfig[]): number {
    if (!crewId) return 0;

    const crew = crews.find((c) => c.id === crewId);
    if (!crew?.color) return 0;

    // Parse hex color to extract hue
    return hexToHue(crew.color);
  }

  /**
   * Get the next rotating palette index for new agents.
   *
   * Cycles through PALETTE_COUNT variants to ensure visual variety
   * when multiple agents are added in sequence.
   *
   * @returns A palette index (0 to PALETTE_COUNT - 1)
   */
  private nextPalette(): number {
    const palette = this.paletteCounter % PALETTE_COUNT;
    this.paletteCounter++;
    return palette;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Release all tracked state.
   *
   * Called when the bridge is unmounted. Clears internal maps but does
   * not remove agents from the OfficeState (the entire state will be
   * discarded along with the bridge).
   */
  dispose(): void {
    this.knownMinions.clear();
    this.costWarningShown.clear();
    this.paletteCounter = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a hex color string to its HSL hue component (0-360).
 *
 * Supports formats: #RGB, #RRGGBB, or named preset strings.
 * Returns 0 for invalid or unrecognized input.
 */
function hexToHue(hex: string): number {
  // Strip leading '#' if present
  let h = hex.startsWith("#") ? hex.slice(1) : hex;

  // Expand shorthand (e.g., "f0a" -> "ff00aa")
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  if (h.length !== 6) return 0;

  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  if (isNaN(r) || isNaN(g) || isNaN(b)) return 0;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  return hue;
}
