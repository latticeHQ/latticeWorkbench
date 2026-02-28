import { z } from "zod";

// Lattice minion config - attached to SSH runtime when using Lattice
export const LatticeMinionConfigSchema = z.object({
  /**
   * Lattice minion name.
   * - For new minions: omit or undefined (backend derives from lattice branch name)
   * - For existing minions: required (the selected Lattice minion name)
   * - After creation: populated with the actual Lattice minion name for reference
   */
  minionName: z.string().optional().meta({ description: "Lattice minion name" }),
  template: z.string().optional().meta({ description: "Template used to create minion" }),
  templateOrg: z.string().optional().meta({
    description: "Template organization (for disambiguation when templates have same name)",
  }),
  preset: z.string().optional().meta({ description: "Preset used during creation" }),

  /** True if connected to pre-existing Lattice minion (vs lattice creating one). */
  existingMinion: z.boolean().optional().meta({
    description: "True if connected to pre-existing Lattice minion",
  }),
});

export type LatticeMinionConfig = z.infer<typeof LatticeMinionConfigSchema>;

// Lattice CLI unavailable reason - "missing" or error with message
export const LatticeUnavailableReasonSchema = z.union([
  z.literal("missing"),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);

export type LatticeUnavailableReason = z.infer<typeof LatticeUnavailableReasonSchema>;

// Lattice CLI availability info - discriminated union by state
// Only checks CLI presence and version — auth state is separate (LatticeWhoami).
export const LatticeInfoSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), version: z.string() }),
  z.object({ state: z.literal("outdated"), version: z.string(), minVersion: z.string() }),
  z.object({ state: z.literal("unavailable"), reason: LatticeUnavailableReasonSchema }),
]);

export type LatticeInfo = z.infer<typeof LatticeInfoSchema>;

// Lattice whoami - authentication identity check (separate from CLI availability)
export const LatticeWhoamiSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("authenticated"),
    username: z.string(),
    deploymentUrl: z.string(),
  }),
  z.object({
    state: z.literal("unauthenticated"),
    reason: z.string(),
  }),
]);

export type LatticeWhoami = z.infer<typeof LatticeWhoamiSchema>;

// Lattice template
export const LatticeTemplateSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  organizationName: z.string(),
});

export type LatticeTemplate = z.infer<typeof LatticeTemplateSchema>;

// Lattice preset for a template
export const LatticePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),
});

export type LatticePreset = z.infer<typeof LatticePresetSchema>;

// Lattice minion status
export const LatticeMinionStatusSchema = z.enum([
  "running",
  "stopped",
  "starting",
  "stopping",
  "failed",
  "pending",
  "canceling",
  "canceled",
  "deleting",
  "deleted",
]);

export type LatticeMinionStatus = z.infer<typeof LatticeMinionStatusSchema>;

// Lattice minion
export const LatticeMinionSchema = z.object({
  name: z.string(),
  templateName: z.string(),
  templateDisplayName: z.string(),
  status: LatticeMinionStatusSchema,
});

export type LatticeMinion = z.infer<typeof LatticeMinionSchema>;

// Lattice minion list result (lets UI distinguish errors from empty list)
export const LatticeListMinionsResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), minions: z.array(LatticeMinionSchema) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type LatticeListMinionsResult = z.infer<typeof LatticeListMinionsResultSchema>;

// Lattice template list result (lets UI distinguish errors from empty list)
export const LatticeListTemplatesResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), templates: z.array(LatticeTemplateSchema) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type LatticeListTemplatesResult = z.infer<typeof LatticeListTemplatesResultSchema>;

// Lattice preset list result (lets UI distinguish errors from empty list)
export const LatticeListPresetsResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), presets: z.array(LatticePresetSchema) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type LatticeListPresetsResult = z.infer<typeof LatticeListPresetsResultSchema>;

// Lattice login result
export const LatticeLoginResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type LatticeLoginResult = z.infer<typeof LatticeLoginResultSchema>;

// API schemas for lattice namespace
export const lattice = {
  getInfo: {
    input: z.void(),
    output: LatticeInfoSchema,
  },
  listTemplates: {
    input: z.void(),
    output: LatticeListTemplatesResultSchema,
  },
  listPresets: {
    input: z.object({
      template: z.string(),
      org: z.string().optional().meta({ description: "Organization name for disambiguation" }),
    }),
    output: LatticeListPresetsResultSchema,
  },
  listMinions: {
    input: z.void(),
    output: LatticeListMinionsResultSchema,
  },
  whoami: {
    input: z
      .object({
        refresh: z.boolean().optional().meta({ description: "Clear cache and re-check" }),
      })
      .optional(),
    output: LatticeWhoamiSchema,
  },
  login: {
    input: z.object({
      url: z.string().meta({ description: "Lattice deployment URL (e.g., https://orbitalclusters.com)" }),
      sessionToken: z.string().meta({ description: "Session token from browser login" }),
    }),
    output: LatticeLoginResultSchema,
  },
};
