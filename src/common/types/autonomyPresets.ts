/**
 * Autonomy Presets — predefined mission profiles for minion creation.
 *
 * Each preset maps to a set of autonomy overrides that are merged with
 * the agent's frontmatter-defined autonomy config at session start.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutonomyPresetId = "inherit" | "guided" | "independent" | "autonomous";

export interface AutonomyOverrides {
  circuitBreaker?: { enabled: boolean; softLimit?: number; hardLimit?: number };
  phases?: { enabled: boolean };
  siblingContext?: { enabled: boolean };
  challenger?: { enabled: boolean };
}

export interface AutonomyPreset {
  id: AutonomyPresetId;
  label: string;
  description: string;
  /** null means "inherit from agent frontmatter" */
  overrides: AutonomyOverrides | null;
}

// ---------------------------------------------------------------------------
// Preset Definitions
// ---------------------------------------------------------------------------

export const AUTONOMY_PRESETS: readonly AutonomyPreset[] = [
  {
    id: "inherit",
    label: "Inherit",
    description: "Use the agent's built-in autonomy settings",
    overrides: null,
  },
  {
    id: "guided",
    label: "Guided",
    description: "Circuit breaker + phases — structured execution with guardrails",
    overrides: {
      circuitBreaker: { enabled: true, softLimit: 6, hardLimit: 10 },
      phases: { enabled: true },
      siblingContext: { enabled: false },
      challenger: { enabled: false },
    },
  },
  {
    id: "independent",
    label: "Independent",
    description: "Circuit breaker + sibling context — aware of other minions",
    overrides: {
      circuitBreaker: { enabled: true, softLimit: 12, hardLimit: 20 },
      phases: { enabled: false },
      siblingContext: { enabled: true },
      challenger: { enabled: false },
    },
  },
  {
    id: "autonomous",
    label: "Fully Autonomous",
    description: "All autonomy features enabled — maximum self-correction",
    overrides: {
      circuitBreaker: { enabled: true, softLimit: 9, hardLimit: 15 },
      phases: { enabled: true },
      siblingContext: { enabled: true },
      challenger: { enabled: true },
    },
  },
] as const;

/**
 * Resolve a preset ID to its overrides. Returns null for "inherit" or unknown IDs.
 */
export function resolvePresetOverrides(presetId: AutonomyPresetId): AutonomyOverrides | null {
  const preset = AUTONOMY_PRESETS.find((p) => p.id === presetId);
  return preset?.overrides ?? null;
}
