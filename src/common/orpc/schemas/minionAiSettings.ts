import { z } from "zod";

/**
 * Minion-scoped AI settings that should persist across devices.
 *
 * Notes:
 * - `model` must be canonical "provider:model" format.
 * - `thinkingLevel` is minion-scoped (saved per minion, not per-model).
 */

export const MinionAISettingsSchema = z.object({
  model: z.string().meta({ description: 'Canonical model id in the form "provider:model"' }),
  thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).meta({
    description: "Thinking/reasoning effort level",
  }),
});

/**
 * Per-agent minion AI overrides.
 *
 * Notes:
 * - Keys are agent IDs (plan/exec/custom), values are model + thinking overrides.
 */
export const MinionAISettingsByAgentSchema = z.record(
  z.string().min(1),
  MinionAISettingsSchema
);
